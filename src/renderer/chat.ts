import type { AgentResult } from "../shared/types";
import {
  COME_LINES,
  DANCE_LINES,
  FLY_LINES,
  UNKNOWN_LINES,
  pick,
  sleepyWrap,
  YAWN_LINES,
} from "./persona";

export type LocalCommand =
  | { kind: "anim"; name: string; line: string }
  | { kind: "come"; line: string }
  | { kind: "fly"; line: string }
  | { kind: "chat"; line: string }
  | { kind: "agent"; prompt: string };

const TASK_RE =
  /(文件夹|目录|mkdir|新建.*文件|创建.*文件|帮我.*(写|做|建|加|创建)|桌面上?(加|建|创建)|打开\s+\S+)/i;

export function parseCommand(raw: string, sleepy: boolean): LocalCommand {
  const text = raw.trim();
  if (!text) return { kind: "chat", line: "……" };

  if (/跳|舞/.test(text)) {
    return { kind: "anim", name: Math.random() < 0.5 ? "spin" : "happy_hop", line: sleepyWrap(pick(DANCE_LINES), sleepy) };
  }
  if (/睡|困|午休|打盹/.test(text)) {
    return { kind: "anim", name: "sleep", line: sleepyWrap("绘梨衣睡。", sleepy) };
  }
  if (/过来|来这|到这|来这边/.test(text)) {
    return { kind: "come", line: sleepyWrap(pick(COME_LINES), sleepy) };
  }
  if (/起飞|飞一?下|飞起来/.test(text)) {
    return { kind: "fly", line: sleepyWrap(pick(FLY_LINES), sleepy) };
  }
  if (/坐下|坐着/.test(text)) {
    return { kind: "anim", name: "sit", line: sleepyWrap("坐下。", sleepy) };
  }
  if (/比心|喜欢/.test(text)) {
    return { kind: "anim", name: "heart", line: sleepyWrap("……给。", sleepy) };
  }
  if (/看|那边/.test(text)) {
    return { kind: "anim", name: "look", line: sleepyWrap("在看。", sleepy) };
  }

  if (TASK_RE.test(text) || /帮我/.test(text) && /(桌面|文件|夹|代码|项目)/.test(text)) {
    return { kind: "agent", prompt: text };
  }

  return { kind: "chat", line: sleepyWrap(replyChat(text, sleepy), sleepy) };
}

function replyChat(text: string, sleepy: boolean): string {
  if (/饿|吃|饭/.test(text)) return "饺子。要很多。";
  if (/路明非|明非/.test(text)) return "路明非呢。绘梨衣等。";
  if (/龙|言灵/.test(text)) return "……绘梨衣是。";
  if (/爱|喜欢你/.test(text)) return "绘梨衣也在。";
  if (/名字|你是谁/.test(text)) return "上杉绘梨衣。";
  if (/垃圾|回收/.test(text)) return "不是。不要。";
  if (/你好|嗨|哈喽|早/.test(text)) return "……嗯。";
  if (sleepy) return pick(YAWN_LINES);
  return pick(UNKNOWN_LINES);
}

export function agentSpeech(result: AgentResult): string {
  if (result.ok) {
    const short = result.text.replace(/\s+/g, " ").slice(0, 80);
    return short ? `好了。${short}` : "好了。";
  }
  if (result.kind === "no_key") return "……不会。密钥还没给绘梨衣。";
  if (result.kind === "start_failed") return "连不上。绘梨衣卡住了。";
  return "没做成。绘梨衣试过了。";
}
