# Contributing

This is an independent derivative of Cruise Webviz. Submit issues and pull requests to this repository, rather than an upstream company-internal repository.

## Reporting problems

Include the Node/browser version, input format, affected topic type, reproduction steps and the expected/actual behavior. Prefer a minimal synthetic recording. Do not attach private recordings, credentials, personal browser screenshots or machine configuration.

## Development

Run `npm run bootstrap` from the root. Use `npm run webviz-dev` for development, and the verification commands in the root README. Keep ROS 1 compatibility and ordinary incremental MarkerArray behavior in mind. Add meaningful regression coverage for data handling and rendering changes. Clearly state when browser validation was not performed.

## Licensing

Submit only contributions that you have the right to share. Unless explicitly stated otherwise, contributions are offered under this project's Apache-2.0 license. Retain upstream and third-party copyright/license notices and mark modifications to upstream files. This independent project does not require a separate contributor license agreement.

The historical upstream contribution agreement is archived in `docs/upstream/CONTRIBUTING.md` for provenance; it is not this project's contribution policy.
