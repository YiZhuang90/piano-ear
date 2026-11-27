# 识音模型的来源和许可

`model.json` 和 `group1-shard1of1.bin` 是 Spotify 的 **Basic Pitch** 模型，原样取自 npm 包 `@spotify/basic-pitch` 1.0.1（源码：github.com/spotify/basic-pitch-ts，论文：Bittner 等，"A Lightweight Instrument-Agnostic Model for Polyphonic Note Transcription and Multipitch Estimation"，ICASSP 2022）。

- 版权：Copyright 2022 Spotify AB
- 许可：Apache License 2.0，全文见 `LICENSE-Apache-2.0.txt`
- 改动：没有改模型文件。`nnpitch.js` 是这里另写的流式调用和打分代码。

模型在浏览器里用 TensorFlow.js 4.22.0 运行（Apache-2.0，Google），从 jsDelivr 按需加载，没有放进仓库。
