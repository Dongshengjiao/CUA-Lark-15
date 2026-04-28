// swift-tools-version: 6.2
//
// M0c state: Core targets renamed OpenIsland → LarkIsland. The
// OpenIslandApp executable + OpenIslandAppTests are still DISABLED
// (~750 dangling refs after M0b's deletions); they will be rewritten
// from scratch in M4 alongside the new web-agent UI panels (input
// panel, overlay, LLM settings).
//
// To re-enable in M4:
//   1. Add `MarkdownUI` package dependency back.
//   2. Add the LarkIslandApp executable product and target.
//   3. Add the LarkIslandAppTests test target.
// Source files at Sources/OpenIslandApp/ and Tests/OpenIslandAppTests/
// remain on disk as reference for the rewrite.

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
    ],
    dependencies: [],
    targets: [
        .target(
            name: "LarkIslandCore"
        ),
        .testTarget(
            name: "LarkIslandCoreTests",
            dependencies: ["LarkIslandCore"]
        ),
    ]
)
