# 3D 绑骨钢琴手（右手）

一只带骨骼的半透明右手，能在网页上的琴键上弹：手指按键、要弹的手指提起来变红、弹对闪绿、整只手换手位时抬起平移。手是半透明的，透过手能看到下面的琴键。最早给「听音钢琴课」用，也可以单独拿去别的项目。

![预览](preview.png)

## 手的模型从哪来

手的网格和骨骼来自 W3C Immersive Web 工作组维护的 WebXR Input Profiles 里的通用手模型（`generic-hand/right.glb`，npm 包 `@webxr-input-profiles/assets`，MIT 授权，Copyright (c) 2019 Amazon）。源码：https://github.com/immersive-web/webxr-input-profiles （`packages/assets/profiles/generic-hand`）。授权原文在 `LICENSE-hand-model.md`，再分发时把它一起带上即可。

原模型是 VR 手部追踪用的 25 个关节，全部挂在根节点下。`src/convert-hand.mjs` 把它转成这里用的格式：

- 关节改成有父子关系的骨骼链，手腕放在原点，手指朝 -Z、手背朝 +Y；
- 做一次细分让表面更圆滑，蒙皮权重一起带过去；
- 把手腕后面 2 厘米的截面拉长成一段约 10 厘米的小臂，渲染时渐隐掉；
- 加上肤色（手心略深）和 `_FINGER`（第几指、权重），用来给单根手指上色。

重新转换：`node src/convert-hand.mjs <generic-hand/right.glb> dist/right-hand.glb 1`（最后的数字是细分次数）。

早先用代码生成的手留在 `src/old/build-hand-procedural.mjs`，现在不用了。

## 手型参照

默认手型（`DEFAULT_POSE`）是对照钢琴教学资料调的，从弹琴的人自己往下看的角度：

- flowkey「Piano Hands」：手落在白键中段、靠近黑键开始的地方；手指弯成「握着一个小球」；拇指自然伸直，用指尖外侧碰键。https://www.flowkey.com/en/piano-hands
- MusicRadar「How to position your hand when you're playing the keyboard」：手腕和手肘略高于键盘，指尖落在白键中间。https://www.musicradar.com/how-to/how-to-position-your-hand-when-youre-playing-the-keyboard
- Fundamentals of Piano Practice（Chuan C. Chang）：手腕和指关节大致齐平，手指大约 45° 落键，用指尖前面的指肚。https://fundamentals-of-piano-practice.readthedocs.io/chapter1/ch1_procedures/II.2.html

所以默认是：手背朝上能看到、手腕低平、四指指尖落在黑键前面一点，拇指在自己白键的前半部分。

## 文件

- `dist/right-hand.glb`：手的模型（glTF 2.0 二进制，单位米）。26 根骨骼：`forearm`、`hand`，`thumb1-3`，`index0-3`、`middle0-3`、`ring0-3`、`pinky0-3`（0 是掌骨），每根手指末端还有 `*Tip`。每根骨骼局部 -Z 顺着手指，+Y 朝指甲。Blender 等软件可以直接导入。
- `dist/piano-hand.js`：动作模块（需要 three.js r160 以上）。
- `dist/demo.html`：演示页，可以点按钮换手位、选手指、弹五指音阶。
- `src/convert-hand.mjs`：上面说的转换脚本。
- `src/preview.mjs`：不用浏览器的离线预览，出一张手放在键盘上的 PNG（`ALPHA=0.5 node src/preview.mjs dist/right-hand.glb out.png 4 hl:2 t:0.6`）。
- `LICENSE-hand-model.md`：手模型的 MIT 授权原文。

## 用法

```html
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
<script type="module">
import { PianoHand } from './piano-hand.js';
// container：盖在 HTML 琴键上的一个 position:absolute 的框，左右和键盘对齐，下面多留几十像素放手腕
const hand = await PianoHand.create({ container, whiteKeys: 12, keyboardHeight: () => kb.clientHeight });
hand.moveTo(4);       // 拇指放在第 4 个白键（最左边是 0），其余四指依次往右
hand.highlight(3);    // 下一个要弹的手指：微微抬起、变红
hand.press(3);        // 按下去，闪绿；hand.press(3, { color: 'miss' }) 闪橙色
hand.play(5, { delay: 0.5, duration: 0.4 }); // 预先安排的一下（先抬指再落下），做示范用
</script>
```

`PianoHand.create` 在没有 WebGL2、模型下载失败或着色器编译失败时会报错，接住它就可以退回 2D 画法。其他选项：

- `opacity`：手的透明度，默认 0.5（1 是不透明）。变红、变绿的那根手指会自动变得几乎不透明，好认。
- `keyLength`：把琴键看成多长（单位是白键宽），决定俯视角度，默认 6.4，和真钢琴的比例差不多。
- `labels`（指尖上的 1-5 数字，默认开）、`shadows`、`maxPixelRatio`。
- `pose`：覆盖 `DEFAULT_POSE` 里的手型参数，比如手腕高度、每个关节的弯曲。

坐标：一个白键宽 = 1。相机是倾斜的正交相机，琴键平面正好对上 HTML 琴键，所以指尖落在哪个键上是算出来的（每根手指用一个小的逆运动学求解），换屏幕尺寸也对得上。

半透明的做法：先画一遍只写深度、不写颜色的手，再画半透明的皮肤，这样只看得到手的外表面，看不到手指背后叠在一起的内侧面。

## 动作

- 休息手型：手指弯成「握着一个球」，指尖落在五个白键上，手背略向小指侧倾。
- 按键：掌指关节和中间关节一起往下，指尖关节保持稳；手腕跟着轻轻一沉、往按键那边转一点，旁边两根手指稍微带一下。
- 换手位：整只手先抬起，平滑移过去再落下，距离越远时间稍长。
- 平时有很轻的呼吸感微动。所有关节用弹簧阻尼跟随，动作是连续的，不会跳。

## 授权

- 手的模型：MIT，Copyright (c) 2019 Amazon（见 `LICENSE-hand-model.md`）。转换后的 `right-hand.glb` 里也写了出处。
- `piano-hand.js`、转换和预览脚本：你自己的代码，授权随你定。
- three.js：MIT，从 CDN 加载。
