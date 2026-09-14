export const CLICK_LINES = [
  "……",
  "绘梨衣在。",
  "嗯。",
  "不要戳。",
  "……饿了。",
  "饺子。",
  "路明非呢。",
  "绘梨衣没有在发呆。",
  "……谁。",
];

export const HAPPY_LINES = [
  "……开心。",
  "跳。",
  "绘梨衣喜欢。",
  "再来。",
];

export const HELD_LINES = [
  "？",
  "放下来。",
  "绘梨衣会掉。",
  "……不要拎头发。",
];

export const LAND_LINES = [
  "咚。",
  "……地好硬。",
  "绘梨衣落地了。",
];

export const THROW_LINES = [
  "飞起来了。",
  "……风。",
  "绘梨衣是龙。",
];

export const SLEEP_LINES = [
  "……困。",
  "绘梨衣睡觉。",
  "Zzz。",
  "不要吵。",
];

export const YAWN_LINES = [
  "哈啊……",
  "……眼皮沉。",
  "绘梨衣要迷糊了。",
  "再说……什么来着。",
];

export const PANIC_LINES = [
  "不是垃圾。",
  "绘梨衣不要那里。",
  "跑。",
  "……那个洞会吃东西。",
];

export const FOLDER_LINES = [
  "盒子。",
  "里面有什么。",
  "绘梨衣坐下。",
  "软软的。",
];

export const LOOK_LINES = [
  "那是什么。",
  "……在动。",
  "给绘梨衣？",
];

export const IDLE_LINES = [
  "……",
  "绘梨衣等。",
  "路明非还没回来。",
];

export const COME_LINES = ["来了。", "绘梨衣走过去。", "嗯。"];
export const DANCE_LINES = ["转。", "绘梨衣跳。", "……这样吗。"];
export const FLY_LINES = ["起飞。", "绘梨衣飞一下。"];
export const UNKNOWN_LINES = ["……听不懂。", "再说一遍。", "绘梨衣只会一点点话。"];

export const HOUR_LINES: Record<number, string[]> = {
  8: ["早。", "绘梨衣醒了。"],
  12: ["午饭。饺子。"],
  18: ["晚饭。还是饺子。"],
  22: ["晚安。", "灯……可以关。"],
  23: ["睡。绘梨衣先睡。"],
  0: ["还没睡。", "……黑。"],
};

export const HOLIDAYS: { md: string; lines: string[] }[] = [
  { md: "01-01", lines: ["新年。", "绘梨衣还在。"] },
  { md: "02-14", lines: ["……巧克力？", "绘梨衣要饺子。"] },
  { md: "09-25", lines: ["月饼也可以。", "圆。"] },
  { md: "10-01", lines: ["放假。绘梨衣不放假。"] },
  { md: "10-31", lines: ["不是鬼。是龙。"] },
  { md: "12-25", lines: ["树亮着。", "绘梨衣不是挂饰。"] },
];

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function sleepyWrap(text: string, sleepy: boolean): string {
  if (!sleepy) return text;
  if (text.endsWith("……")) return text;
  return `${text.replace(/。$/, "")}……`;
}
