import type { Atlas, AtlasAnim } from "../shared/types";
import atlasJson from "../../assets/sprites/atlas.json";
import spriteUrl from "../../assets/sprites/erii.png";

export class SpriteAnimator {
  image: HTMLImageElement | null = null;
  atlas: Atlas | null = null;
  name = "idle";
  frame = 0;
  elapsed = 0;
  oneShot: string | null = null;
  onOneShotEnd: (() => void) | null = null;

  get anim(): AtlasAnim | null {
    const atlas = this.atlas;
    if (!atlas) return null;
    return atlas.animations[this.name] ?? atlas.animations.idle ?? null;
  }

  has(name: string): boolean {
    return Boolean(this.atlas?.animations[name]);
  }

  play(name: string, restart = true): void {
    const resolved = this.has(name) ? name : "idle";
    if (!restart && this.name === resolved) return;
    this.name = resolved;
    this.frame = 0;
    this.elapsed = 0;
    const anim = this.anim;
    this.oneShot = anim && !anim.loop ? resolved : null;
  }

  update(dt: number): void {
    const anim = this.anim;
    if (!anim || anim.frames <= 1) return;
    this.elapsed += dt;
    const spf = 1 / Math.max(anim.fps, 1);
    while (this.elapsed >= spf) {
      this.elapsed -= spf;
      if (this.frame + 1 >= anim.frames) {
        if (anim.loop) this.frame = 0;
        else {
          this.frame = anim.frames - 1;
          if (this.oneShot) {
            this.oneShot = null;
            this.onOneShotEnd?.();
          }
        }
      } else {
        this.frame += 1;
      }
    }
  }

  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    facing: 1 | -1,
    opacity: number,
  ): void {
    if (!this.image || !this.atlas) {
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = "#9aa3ac";
      ctx.strokeStyle = "#2a2a2c";
      ctx.lineWidth = 2;
      const w = 32 * scale;
      const h = 48 * scale;
      ctx.fillRect(x - w / 2, y - h, w, h);
      ctx.strokeRect(x - w / 2, y - h, w, h);
      ctx.restore();
      return;
    }
    const anim = this.anim ?? this.atlas.animations.idle;
    if (!anim) return;
    const [fw, fh] = this.atlas.frameSize;
    const [ax, ay] = this.atlas.anchor;
    const sx = this.frame * fw;
    const sy = anim.row * fh;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(x, y);
    ctx.scale(facing * scale, scale);
    ctx.drawImage(this.image, sx, sy, fw, fh, -ax, -ay, fw, fh);
    ctx.restore();
  }

  hitSize(scale: number): { w: number; h: number } {
    if (!this.atlas) return { w: 64 * scale, h: 64 * scale };
    const [fw, fh] = this.atlas.frameSize;
    return { w: fw * scale, h: fh * scale };
  }
}

export async function loadAtlas(): Promise<{ image: HTMLImageElement; atlas: Atlas }> {
  const atlas = atlasJson as Atlas;
  const image = new Image();
  image.src = spriteUrl;
  await image.decode();
  return { image, atlas };
}
