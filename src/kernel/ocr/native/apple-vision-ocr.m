#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

static void PrintJsonError(NSString *code, NSString *message) {
  NSDictionary *payload = @{
    @"ok" : @NO,
    @"error" : @{@"code" : code, @"message" : message},
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  fwrite(data.bytes, 1, data.length, stdout);
  fputc('\n', stdout);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      PrintJsonError(@"MISSING_IMAGE_PATH", @"Usage: apple-vision-ocr <image-path>");
      return 2;
    }

    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSURL *url = [NSURL fileURLWithPath:path];
    NSImage *image = [[NSImage alloc] initWithContentsOfURL:url];
    if (image == nil) {
      PrintJsonError(@"IMAGE_LOAD_FAILED", @"Image could not be loaded by AppKit");
      return 3;
    }

    CGImageRef cgImage = [image CGImageForProposedRect:NULL context:nil hints:nil];
    if (cgImage == NULL) {
      PrintJsonError(@"CGIMAGE_FAILED", @"Image could not be converted to CGImage");
      return 4;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    request.recognitionLanguages = @[ @"zh-Hant", @"zh-Hans", @"en-US" ];

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
    NSError *error = nil;
    BOOL ok = [handler performRequests:@[ request ] error:&error];
    if (!ok) {
      NSString *message = error == nil ? @"Vision request failed" : error.localizedDescription;
      PrintJsonError(@"VISION_REQUEST_FAILED", message);
      return 5;
    }

    NSMutableArray *lines = [NSMutableArray array];
    NSArray<VNRecognizedTextObservation *> *observations = request.results ?: @[];
    for (VNRecognizedTextObservation *observation in observations) {
      VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
      if (candidate == nil || candidate.string.length == 0) {
        continue;
      }
      CGRect box = observation.boundingBox;
      [lines addObject:@{
        @"text" : candidate.string,
        @"confidence" : @(candidate.confidence),
        @"boundingBox" : @{
          @"x" : @(box.origin.x),
          @"y" : @(box.origin.y),
          @"width" : @(box.size.width),
          @"height" : @(box.size.height),
        },
      }];
    }

    NSDictionary *payload = @{
      @"ok" : @YES,
      @"provider" : @"apple-vision",
      @"lines" : lines,
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
  }
  return 0;
}
