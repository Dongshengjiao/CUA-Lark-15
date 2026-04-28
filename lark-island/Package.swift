// swift-tools-version: 6.2
//
// M0b state: OpenIslandApp / OpenIslandAppTests targets are temporarily
// DISABLED. AppModel.swift + Views/* still hold ~750 dangling references
// to coding-agent types that have been deleted in M0b. Rather than
// rewriting them now, we ship Core as a standalone library and leave the
// dynamic-island UI rewrite to M4, where it will be redone alongside the
// new web-agent UI panels (input panel, overlay, LLM settings).
//
// To re-enable in M4:
//   1. Add `MarkdownUI` package dependency back.
//   2. Add the OpenIslandApp executable product and target.
//   3. Add the OpenIslandAppTests test target.
// Source files at Sources/OpenIslandApp/ and Tests/OpenIslandAppTests/
// remain on disk as reference for the rewrite.

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
    ],
    dependencies: [],
    targets: [
        .target(
            name: "OpenIslandCore"
        ),
        .testTarget(
            name: "OpenIslandCoreTests",
            dependencies: ["OpenIslandCore"]
        ),
    ]
)
