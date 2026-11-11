# 15: 3D 办公室场景（后方斜俯视 · 8 工位 · 咖啡机/饮水机）

**What to build:** 把原来的平面 2D 工位画面换成真正的 3D 办公室：后方斜俯视全览、可容纳 8 个工位、一个咖啡机、一个饮水机；桌子/显示器/座椅/书架/窗景/吊灯/绿植等要成体系，工位状态和员工仍可交互。

**Blocked by:** 14 号票（模型库/统一设置）done

**Status:** done

- [x] Blender 建模：房间、后墙、侧墙、地板、窗户、书架、绿植、吊灯、8 套桌椅/显示器/桌搭
- [x] 咖啡机（含冲煮头/蒸汽棒/杯/粉碗）与饮水机（桶装水/冷热龙头/接水盘）在场景内可见
- [x] 导出 `office.glb` 并在 Electron 渲染进程用 Three.js 加载
- [x] 后方斜俯视相机：一次看全 8 工位 + 咖啡/饮水角，1280 与 900×600 都不裁桌面
- [x] 员工为 3D 低模层：按角色着色；在岗/摸鱼/离座/忙碌有可见差异
- [x] 显示器屏幕按 read/write/exec/test pass/fail 实时换画面
- [x] 工位 DOM 标签/气泡/状态灯按 3D 相机投影定位；点击/键盘交互不丢
- [x] 数据库从 4 工位扩到 8 工位；旧库自动补齐缺失工位，不移动已有员工
- [x] `npm run typecheck`、`npm test`、e2e 02–14 全过

## Answer

### 场景

- `scripts/blender/office-scene.py` 生成 `renderer/public/office/office.glb`：8 张带显示器/键盘/鼠标/杯子/绿植的工位、8 把五星脚椅、后墙窗景、书架、吊灯、地毯、侧墙、咖啡角与饮水机。
- `renderer/src/scene/Office3D.jsx` 用 Three.js 加载 GLB；相机在后方偏右、向下约 35°，目标点落在房间中部，使用 `34°` 透视。灯光是暖色窗光 + 冷色补光 + 半球环境光，桌面/椅子/书架有软阴影。
- 3D 模型名 `Desk1..Desk8_*` 与 `DESK_LAYOUT`/数据库的 4×2 顺序一致；Blender 场景以 Y 为垂直轴，导出时 `export_yup=False`，避免二次旋转。
- 咖啡机在左前角吧台：机身、冲煮头、粉碗、蒸汽棒、杯、豆仓、吧台柜门；饮水机在左后角抬高底座上：桶装水、冷热龙头、接水盘。两者都有 DOM 贴标。
- 员工的 3D 低模层（头/发/躯干/手臂/耳机/眼镜/领带/手机）在椅子与桌面之间，按 `deskState` 切换工作/摸鱼/离座；显示器用 `CanvasTexture` 逐桌更新，测试通过/失败是整屏绿/红。
- 工位标签、气泡、状态灯、拒绝提示仍是 DOM，按 Three.js 相机投影到 3D 屏幕坐标；空工位只留小「+」提示，悬停展开「空位」。
- 数据库 `DESK_SLOTS` 从 4 扩到 8；`ensureDeskCapacity` 在打开旧库时只追加缺失工位，已有 desk id/员工不动。

### 验证

- `npm run typecheck` 通过。
- `npm test`：399/399（新增旧库补 8 工位迁移测试）。
- `npm run e2e:02`：8 个工位、切项目组仍是 8 个；
- `npm run e2e:03`：8 工位下招聘/重启；
- `npm run e2e:07`：3D 场景下工位动画/名牌气泡开关；
- `npm run e2e:08`：WebGL 画布 + 8 工位 + 咖啡机/饮水机标签 + 900×600 画布不被挤；
- `npm run e2e:11/13/14`：codex/dsh/打包路径仍通过。
- 截图：`tmp/ui-shot/shots/10-office-tall.png`、`13-narrow-office.png`、`zoom-3d-*.png`；Blender 源脚本 `scripts/blender/office-scene.py`。

### 残留

- 3D 角色是低模程序化层，不是绑定骨骼/动画资产；动作是位置与手臂的轻量变化。
- 显示器屏幕是 CanvasTexture 概览画，不是真实应用窗口。
- 咖啡机/饮水机是程序化 Blender 低模，细节可见但非工业级产品建模；后续可在 Blender 里替换同位置 GLB 资产而不动渲染层。
