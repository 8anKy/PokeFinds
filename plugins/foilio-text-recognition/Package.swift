// swift-tools-version: 5.9
import PackageDescription

// Foilio — on-device textigenkänning på iOS via Apple Vision. Ren SPM, inga
// externa paket: Vision är ett systemramverk. Samma mall som @capacitor/haptics.
let package = Package(
    name: "FoilioTextRecognition",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "FoilioTextRecognition",
            targets: ["FoilioTextRecognitionPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "FoilioTextRecognitionPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/FoilioTextRecognitionPlugin")
    ]
)
