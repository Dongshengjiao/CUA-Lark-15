// swift-tools-version: 6.2
//
// M4 state: LarkIslandApp executable target re-enabled. Per
// openspec/changes/m4-island-ui-rewrite/, the dynamic-island chrome
// from open-vibe-island is preserved and minimal-patched while
// AppModel + 4 SwiftUI Views are rewritten for the web-agent product.
// The disabled OpenIslandAppTests stays out — its 3 test files were
// tightly coupled to deleted coding-agent types and won't be revived.
// New M4-specific tests live alongside this target as small, focused
// suites where they make sense (bridge routing, profile store).

import PackageDescription

let package = Package(
    name: "LarkIsland",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .library(
            name: "LarkIslandCore",
            targets: ["LarkIslandCore"]
        ),
        .executable(
            name: "LarkIslandApp",
            targets: ["LarkIslandApp"]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/swift-markdown-ui", from: "2.4.1"),
    ],
    targets: [
        .target(
            name: "LarkIslandCore"
        ),
        .executableTarget(
            name: "LarkIslandApp",
            dependencies: [
                "LarkIslandCore",
                .product(name: "MarkdownUI", package: "swift-markdown-ui"),
            ],
            resources: [
                .process("Resources"),
            ]
        ),
        .testTarget(
            name: "LarkIslandCoreTests",
            dependencies: ["LarkIslandCore"]
        ),
    ]
)
