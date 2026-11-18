//  Copyright (c) 2018-present, GM Cruise LLC
//
//  This source code is licensed under the Apache License, Version 2.0,
//  found in the LICENSE file in the root directory of this source tree.
//  You may not use this file except in compliance with the License.
// Modified in the Webviz ROS 2 MCAP project; see MODIFICATIONS.md at the repository root.

module.exports = {
  presets: ["@babel/preset-react", "@babel/preset-flow"],
  env: { test: { plugins: ["@babel/plugin-transform-dynamic-import"] } },
  plugins: [
    "@babel/plugin-transform-modules-commonjs",
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-proposal-nullish-coalescing-operator",
    "@babel/plugin-proposal-optional-chaining",
    "@babel/plugin-syntax-dynamic-import",
    ["@babel/plugin-proposal-object-rest-spread", { useBuiltIns: true }],
    // module-resolver allows us to use absolute import paths
    ["module-resolver", { root: ["packages"] }],
  ],
};
