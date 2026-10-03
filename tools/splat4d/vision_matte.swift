import CoreGraphics
import CoreVideo
import Foundation
import Vision

let width = Int(CommandLine.arguments[1])!
let height = Int(CommandLine.arguments[2])!
let frameBytes = width * height * 3
let colorSpace = CGColorSpace(name: CGColorSpace.itur_709) ?? CGColorSpaceCreateDeviceRGB()
let input = FileHandle.standardInput
let output = FileHandle.standardOutput

func readFrame() -> Data? {
    var frame = Data(capacity: frameBytes)
    while frame.count < frameBytes {
        let chunk = input.readData(ofLength: frameBytes - frame.count)
        if chunk.isEmpty { return nil }
        frame.append(chunk)
    }
    return frame
}

func image(from frame: Data) -> CGImage? {
    guard let provider = CGDataProvider(data: frame as CFData) else { return nil }
    return CGImage(
        width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 24, bytesPerRow: width * 3,
        space: colorSpace, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
}

func coverage(of mask: CVPixelBuffer) -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: width * height)
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(mask) else { return bytes }
    let rowBytes = CVPixelBufferGetBytesPerRow(mask)
    let maskWidth = CVPixelBufferGetWidth(mask)
    let maskHeight = CVPixelBufferGetHeight(mask)
    let isFloat = CVPixelBufferGetPixelFormatType(mask) == kCVPixelFormatType_OneComponent32Float
    for y in 0..<height {
        let sourceY = min(maskHeight - 1, y * maskHeight / height)
        let row = base.advanced(by: sourceY * rowBytes)
        for x in 0..<width {
            let sourceX = min(maskWidth - 1, x * maskWidth / width)
            let value: Float = isFloat
                ? row.assumingMemoryBound(to: Float.self)[sourceX]
                : Float(row.assumingMemoryBound(to: UInt8.self)[sourceX]) / 255
            bytes[y * width + x] = UInt8(max(0, min(255, (value * 255).rounded())))
        }
    }
    return bytes
}

while let frame = readFrame() {
    var mask = [UInt8](repeating: 0, count: width * height)
    if let picture = image(from: frame) {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: picture)
        if (try? handler.perform([request])) != nil,
           let observation = request.results?.first,
           let scaled = try? observation.generateScaledMaskForImage(forInstances: observation.allInstances, from: handler) {
            mask = coverage(of: scaled)
        }
    }
    output.write(Data(mask))
}
