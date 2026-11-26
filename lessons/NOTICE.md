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

## 本项目自己写的
- score.js（读 MusicXML、推指法、分手、配伴奏）、课程表 curriculum.json、关卡说明文字。
