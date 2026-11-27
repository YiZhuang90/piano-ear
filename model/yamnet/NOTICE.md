# 人声过滤模型的来源和许可

这里是 Google 的 **YAMNet** 声音分类模型（AudioSet 上训练，能分 521 类声音），用来判断麦克风里是有人在说话/唱歌，还是在弹琴。

- 来源：tensorflow/models 仓库的 research/audioset/yamnet（模型代码 yamnet.py、params.py、features.py）和 Google 公开的权重文件 yamnet.h5（storage.googleapis.com/audioset/yamnet.h5）
- 版权：Copyright The TensorFlow Authors / Google LLC
- 许可：Apache License 2.0，全文见 `LICENSE-Apache-2.0.txt`
- 改动：
  1. 只转了“对数梅尔谱 → 分数”这一段，特征计算在 `voicegate.js` 里照 features.py 用 JS 重写（和原版逐项比对，误差小于 0.0001）。
  2. 最后一层分类只留了 31 个类别（顺序见 `classes.json`）：说话、小孩说话、对话、旁白、咿呀学语、合成语音、喊叫、叫嚷、小孩喊叫、耳语、笑声、婴儿笑、咯咯笑、唱歌、合唱、念诵、小孩唱歌、哼歌、口哨、人声嘈杂、小孩玩耍、说唱；音乐、乐器、键盘乐器、钢琴、电钢琴、风琴、电子风琴、合成器、羽管键琴。这些类别的权重原样保留，其余删掉。
  3. 用 TensorFlow.js 转换工具转成网页格式，权重按 8 位量化（约 3.2 MB）。
