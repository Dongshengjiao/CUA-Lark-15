// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "OpenIsland",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "OpenIslandCore",
            targets: ["OpenIslandCore"]
        ),
        .executable(
            name: "OpenIslandApp",
            targets: ["OpenIslandApp"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/swift-markdown-ui", from: "2.4.1"),
    ],
    targets: [
        .target(
            name: "OpenIslandCore"
        ),
        .executableTarget(
            name: "OpenIslandApp",
            dependencies: [
                "OpenIslandCore",
                .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            ],
            resources: [
                .process("Resources"),
            ]
        ),
        .testTarget(
            name: "OpenIslandCoreTests",
            dependencies: ["OpenIslandCore"]
        ),
        .testTarget(
            name: "OpenIslandAppTests",
            dependencies: ["OpenIslandApp", "OpenIslandCore"]
        ),
    ]
)
