# Vivaria - Glass Grove 🌱

> Grow a tiny world from nothing — nuôi một thế giới nhỏ từ con số không.

A cozy desktop idle game. Pick how much of your glass tank is **water vs land**
(0–100%), and watch a sterile jar slowly come alive: microbes shimmer, algae
films spread, plants take root, and small creatures arrive — shrimp, tetras,
snails, fiddler crabs, froglets, moths — each on its own clock. The world keeps
growing (gently, capped at a day) while the app is closed.

Soft Ghibli-warm palette, procedural audio, water that sloshes when you drag
the window, and a field journal that remembers every first sighting.

## Chơi như thế nào

- **Kéo thanh trượt** chọn tỉ lệ nước/cạn — mỗi tỉ lệ là một thế giới khác:
  - 0% cạn → bể thủy sinh (cá tetra, cory, rận nước)
  - giữa → bán cạn / paludarium — **nhiều loài độc quyền nhất** (cua, ếch)
  - 100% cạn → terrarium khô (bọ đất, ốc rêu, bướm đêm)
- **Seed** là chữ bất kỳ — cùng seed + cùng tỉ lệ = cùng thế giới, mãi mãi.
- Không có thua. Không có việc phải làm gấp. Cứ để bể chạy và thỉnh thoảng ghé thăm.
- Mở **Almanac** để xem các cột mốc và loài đã gặp (13 loài, không tỉ lệ nào thấy đủ hết).

## Development

```bash
pnpm install
pnpm dev            # browser dev at :1420 (?land=35&simHours=50 to time-travel)
pnpm tauri dev      # run inside the desktop shell
pnpm test           # 88 vitest tests (sim determinism is the load-bearing wall)
pnpm test:coverage  # 80%+ enforced on sim/persistence/game
pnpm tauri build    # NSIS installer (~2MB) at src-tauri/target/release/bundle/nsis
```

Dev tools:

```bash
pnpm exec vite-node scripts/render-tank.ts    # dump procgen previews to tmp/
pnpm exec vite-node scripts/screenshot.ts "land=35&simHours=100" tmp/shot.png
pnpm exec vite-node scripts/e2e-save.ts       # save/continue/journal e2e
pnpm exec vite-node scripts/make-icon.ts      # regenerate the app icon
```

## Architecture (the short version)

- **Sim**: pure TS, ONE `integrate()` function is the only way time advances —
  live ticks, offline catch-up, and tests share it (golden-master verified).
  Counter-based seeded RNG ⇒ stepped === batched, always.
- **Procgen**: `(seed, landPercent)` → deterministic tank: waterline-first
  terrain, one clean water body, beach sand, zones, static light/moisture fields.
- **Render**: PixiJS v8 (WebGL pinned), render-on-demand dirty flag — a still
  tank renders nothing; minimized costs ~0% CPU. Cabinet-oblique glass box,
  damped-spring water slosh fed by Tauri `onMoved`.
- **Persistence**: zod-validated JSON, Rust atomic writes + rolling backup,
  schema migration chain.
- Full contract in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), content
  roadmap in [docs/DESIGN-BIBLE.md](docs/DESIGN-BIBLE.md).

## License

MIT (code). Icon paths in `src/ui/icons.tsx` from [Lucide](https://lucide.dev), ISC.
