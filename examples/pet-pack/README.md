# 宠物包模板（Sample Pack）

这是一个**完整可用的宠物包模板**。最简单的试用方式——在 Pi 里直接执行：

```
/pets import C:\path\to\agentMon\examples\pet-pack
```

（路径指向这个文件夹即可，也可以直接指向 `pack.json` 文件。）导入后 `/pets list` 应该能看到 `sample`，`/pets use sample` 立刻换上。确认流程通了以后，把 `pack.json` 里的内容换成你自己的。手动把这个文件夹拷到 `~/.pi/agent/agentmon/pets/` 下面也可以，效果相同。

> 模板里的精灵图是 agentMon 自创的 Byte（原创素材，可以随便抄）。
> **如果你导入的是数码宝贝等商业角色的提取素材：那些图版权归 Bandai 等权利方，只能放在你自己机器上私用，绝不要提交到任何公开仓库。**

## pack.json 逐字段说明

```jsonc
{
  // 包的显示名（随便起）
  "name": "Sample pack (template)",

  // 物种列表：一个包可以放多只
  "species": [
    {
      // id：小写字母/数字/连字符，用于 /pets use <id> 和进化规则引用
      "id": "sample",
      // 显示名
      "name": "Sample",
      // "baby" 或 "branch"（目前只影响显示）
      "stage": "branch",
      // 可选：一句话介绍
      "description": "…",

      // 【核心】11 个姿势 = 全部动画素材。没有单独的动画文件——
      // "动画"就是姿势列表 + 下面的 roles 循环表：
      //   每个姿势是 16 行 × 16 字符， '#' 或 '1' = 亮， '.' 或 '0' = 灭；
      //   第 14、15 行留空（自垫两行），脚踩在第 13 行，和内置生物对齐。
      "poses": {
        "idleA":  ["................", "…共16行…"],
        "idleB":  ["…"],
        "think":  ["…"],   // agent 思考时
        "search": ["…"],   // 读代码/搜索时
        "codeA":  ["…"],   // 写代码（两帧交替敲打）
        "codeB":  ["…"],
        "testA":  ["…"],   // 跑测试（两帧交替）
        "testB":  ["…"],
        "happy":  ["…"],   // 测试通过/任务完成的庆祝
        "sad":    ["…"],   // 测试失败/被纠正
        "sleep":  ["…"]    // 会话结束
      },

      // 可选：活动 → 姿势循环表。不写就用上面注释里的默认表。
      // 两帧的活动会以 ~3帧/秒 交替，单帧活动静止。
      "roles": {
        "idle": ["idleA", "idleB"],
        "walk": ["idleA", "idleB"],
        "think": ["think"],
        "search": ["search"],
        "code": ["codeA", "codeB"],
        "test": ["testA", "testB"],
        "happy": ["happy"],
        "sad": ["sad"],
        "sleep": ["sleep"]
      }
    }
  ],

  // 可选：进化规则，接入和内置进化完全相同的多条件门控系统。
  // axis ∈ research | implementation | validation（对应三条特质轴）
  "evolutions": [
    {
      "from": "byte",          // 从内置幼年体进化成你的
      "to": "sample",
      "gates": {
        "minLevel": 2,          // 等级 ≥ 2
        "axis": "research",     // 研究特质占比 ≥ 40%
        "minTraitShare": 0.4,
        "minTasks": 3,          // 完成 ≥ 3 个任务
        "maxCareMistakes": 3,   // 失误 ≤ 3
        "minValidatedRatio": 0.6  // 可选：验证过的任务比例（纪律门）
      }
    }
  ]
}
```

## 三种导入方式

1. **命令导入（推荐）**：`/pets import <pack.json 或文件夹路径>`——自动安装、校验、即时生效。
2. **从 tuipet/DVPet 提取文件导入**（你自己的提取数据）：
   - Pi 里：`/pets import path/to/sprites.json 亚古兽名,暴龙兽名`（自动串进化链）
   - 或命令行：`npm run pack:from-tuipet -- --sprites path/to/sprites.json --names "Agumon,Greymon" --chain`
   - 支持 `.json` 和 `.json.gz`；帧位映射可用 `--map "think=3,codeA=7"` 调整（默认映射见 docs/pet-packs.md）。
3. **手写/手改**：复制这个模板，替换 poses 里的行，然后 `/pets import` 或放进 `~/.pi/agent/agentmon/pets/`。

校验：`npm run packs`（或 `--dir 指定目录`）。

验证细节和完整规则见仓库根的 [docs/pet-packs.md](../../docs/pet-packs.md)。
