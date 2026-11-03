// Draws the app icon: a dark rounded square with the character 听. Usage: swift scripts/make-icon.swift apps/desktop/assets
import AppKit

func png(size: Int) -> Data {
    let side = CGFloat(size)
    let image = NSImage(size: NSSize(width: side, height: side))
    image.lockFocus()
    let body = NSRect(x: 0, y: 0, width: side, height: side).insetBy(dx: side * 0.06, dy: side * 0.06)
    NSColor(srgbRed: 0.098, green: 0.094, blue: 0.086, alpha: 1).setFill()
    NSBezierPath(roundedRect: body, xRadius: side * 0.22, yRadius: side * 0.22).fill()
    let font = NSFont(name: "Songti SC Bold", size: side * 0.56) ?? NSFont.systemFont(ofSize: side * 0.56, weight: .bold)
    let text = NSAttributedString(string: "听", attributes: [.font: font, .foregroundColor: NSColor(srgbRed: 1, green: 0.996, blue: 0.98, alpha: 1)])
    let box = text.size()
    text.draw(at: NSPoint(x: (side - box.width) / 2, y: (side - box.height) / 2 - side * 0.015))
    image.unlockFocus()
    let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
    return rep.representation(using: .png, properties: [:])!
}

let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
let iconset = "\(output)/icon.iconset"
try FileManager.default.createDirectory(atPath: iconset, withIntermediateDirectories: true)
for (name, size) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
    try png(size: size).write(to: URL(fileURLWithPath: "\(iconset)/icon_\(name).png"))
}
