# 听音钢琴课

手机浏览器里用麦克风听你弹的音，带零基础一首首跟弹：找中央 C、小星星、两只老虎、欢乐颂、自由弹。

- `index.html`：整个网页，单文件，不用安装。
- `detector.js`：单音音高（YIN）和起音检测。
- `test-detector.js`：用合成钢琴音离线测试，`node test-detector.js`。

只识别单音，不识别和弦。麦克风需要 https 才能用，所以放在 GitHub Pages 上。
