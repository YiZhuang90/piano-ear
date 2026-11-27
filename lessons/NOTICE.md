# 课程数据来源和许可

## 拜厄乐谱（lessons/beyer/*.musicxml）
- 作品：Ferdinand Beyer《钢琴基本教程》Op.101（1850），作品本身是公有领域。
- 数字化来源：GitHub 上的 PPP 项目（https://github.com/kimyir111/PPP ，提交 56557ee）。按它的 THIRD_PARTY_NOTICES.md：拜厄从 1895 年莱比锡 Peters 版（A. Ruthardt 校订）的公有领域扫描录入，只有学生声部（原书前面的四手联弹里老师那一声部没有录），以 CC0 / 公有领域发布。每个文件里的 `<rights>` 也写着 Public domain。
- 我们只从 .mxl 解压成 .musicxml，没有改音符。
- 不是原书的东西：网页上显示的指法是程序按“五指位”推出来的（原谱里有指法时用原谱的）；“配伴奏”是程序按每小节的音选 I / IV / V7 配的简单低音和和弦，不是拜厄写的老师声部。两样在网页上都写明了。
- 没有用任何现代版本加的指法或注释。

## 儿歌和入门关（lessons/curriculum.json）
- 《欢乐颂》《小星星》《玛丽有只小羊羔》《两只老虎》《铃儿响叮当》《热十字面包》等旋律都是公有领域民歌或古典旋律，简谱是本项目自己记的。

## 五线谱显示
- OpenSheetMusicDisplay 2.3.1（BSD-3-Clause），网页运行时从 jsDelivr 加载。
- 认谱入门（第 0.5 关）的五线谱用 VexFlow 4.2.3（MIT 许可，作者 Mohit Muthanna Cheppudira 等，https://github.com/0xfe/vexflow ），网页运行时从 jsDelivr 加载；加载不了时用 noteread.js 自己画的简单五线谱。

## 认谱入门（noteread.js）
- 复习方法是公开的“莱特纳记忆盒子”（Leitner system）：每个音一个盒子号，弹对升一格，弹错回到 0。代码是本项目自己写的。
- 看过的开源认谱练习：TeemuKoivisto/midi-note-trainer（MIT，同样用 VexFlow），只借鉴了“用 VexFlow 画单个音”的做法，没有复制代码；其他找到的认谱程序是 GPL 或没有写许可，没有用。
- 认谱课的小曲（热十字包、欢乐颂、小星星、玛丽有只小羊羔、小船轻划、《普世欢腾》开头一句）都是公有领域旋律，简谱是本项目自己记的；《普世欢腾》一句的节奏简化过。

## 本项目自己写的
- score.js（读 MusicXML、推指法、分手、配伴奏）、课程表 curriculum.json、关卡说明文字。

## 儿童版（kids.js / kids.css）
- 语音提示：浏览器自带的朗读功能（Web Speech API 的 speechSynthesis，用手机里的中文语音），不录音、不下载。
- 图标：系统自带的表情符号（emoji），不带图标文件。
- 音效（弹对的“叮咚”、弹完的小号声）：网页用 Web Audio 自己合成，没有音频素材。
- 彩色手指、图画地图、动画：本项目自己写的 CSS 和代码。
