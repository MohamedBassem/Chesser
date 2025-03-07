import {
  App,
  EditorPosition,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  parseYaml,
  stringifyYaml,
} from "obsidian";
import { Chess, ChessInstance, Move, Square } from "chess.js";
import { Chessground } from "chessground";
import { Api } from "chessground/api";
import { Color, Key } from "chessground/types";
import { DrawShape } from "chessground/draw";

import { ChesserConfig } from "./ChesserConfig";
import { ChesserSettings } from "./ChesserSettings";
import ChesserMenu from "./menu";

// To bundle all css files in styles.css with rollup
import "../assets/custom.css";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
// Piece styles
import "../assets/piece-css/alpha.css";
import "../assets/piece-css/california.css";
import "../assets/piece-css/cardinal.css";
import "../assets/piece-css/cburnett.css";
import "../assets/piece-css/chess7.css";
import "../assets/piece-css/chessnut.css";
import "../assets/piece-css/companion.css";
import "../assets/piece-css/dubrovny.css";
import "../assets/piece-css/fantasy.css";
import "../assets/piece-css/fresca.css";
import "../assets/piece-css/gioco.css";
import "../assets/piece-css/governor.css";
import "../assets/piece-css/horsey.css";
import "../assets/piece-css/icpieces.css";
import "../assets/piece-css/kosal.css";
import "../assets/piece-css/leipzig.css";
import "../assets/piece-css/letter.css";
import "../assets/piece-css/libra.css";
import "../assets/piece-css/maestro.css";
import "../assets/piece-css/merida.css";
import "../assets/piece-css/pirouetti.css";
import "../assets/piece-css/pixel.css";
import "../assets/piece-css/reillycraig.css";
import "../assets/piece-css/riohacha.css";
import "../assets/piece-css/shapes.css";
import "../assets/piece-css/spatial.css";
import "../assets/piece-css/staunty.css";
import "../assets/piece-css/tatiana.css";
// Board styles
import "../assets/board-css/brown.css";
import "../assets/board-css/blue.css";
import "../assets/board-css/green.css";
import "../assets/board-css/purple.css";
import "../assets/board-css/ic.css";
import debug from "./debug";

export function draw_chessboard(app: App, settings: ChesserSettings) {
  return (
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) => {
    let default_config: ChesserConfig = {
      ...settings,
      fen: "",
    };

    let user_config = default_config;
    try {
      user_config = parseYaml(source);
    } catch (e) {
      // failed to parse
    }
    ctx.addChild(new Chesser(el, ctx, default_config, user_config, app));
  };
}

export class Chesser extends MarkdownRenderChild {
  private ctx: MarkdownPostProcessorContext;
  private app: App;

  private cg: Api;
  private chess: ChessInstance;
  private config: ChesserConfig;
  private user_config: ChesserConfig;

  private menu: ChesserMenu;
  private moves: Move[];

  public currentMoveIdx: number;

  constructor(
    containerEl: HTMLElement,
    ctx: MarkdownPostProcessorContext,
    default_config: ChesserConfig,
    user_config: ChesserConfig,
    app: App
  ) {
    super(containerEl);

    this.app = app;
    this.ctx = ctx;
    this.chess = new Chess();
    this.user_config = user_config;
    this.config = {
      ...default_config,
      ...user_config
    };

    this.sync_board_with_gamestate = this.sync_board_with_gamestate.bind(this);
    this.save_move = this.save_move.bind(this);
    this.save_shapes = this.save_shapes.bind(this);

    if (this.config.pgn) {
      debug(() => console.debug("loading from pgn", this.config.pgn));
      this.chess.load_pgn(this.config.pgn);
    } else if (this.config.fen) {
      debug(() => console.debug("loading from fen", this.config.fen));
      this.chess.load(this.config.fen);
    }

    this.moves = this.chess.history({ verbose: true });
    this.currentMoveIdx = this.config.currentMoveIdx ?? this.moves.length - 1;

    let lastMove: [Key, Key] = undefined;
    if (this.currentMoveIdx >= 0) {
      const move = this.moves[this.currentMoveIdx];
      lastMove = [move.from, move.to];
    }

    // Setup UI
    this.set_style(containerEl, this.config.pieceStyle, this.config.boardStyle);
    try {
      this.cg = Chessground(containerEl.createDiv(), {
        fen: this.chess.fen(),
        addDimensionsCssVars: true,
        lastMove,
        orientation: this.config.orientation as Color,
        viewOnly: this.config.viewOnly,
        drawable: {
          enabled: this.config.drawable,
          onChange: this.save_shapes,
        },
      });
    } catch (e) {
      new Notice("Chesser error: Invalid config");
      console.error(e);
      return;
    }

    // Activates the chess logic
    this.setFreeMove(this.config.free);

    // Draw saved shapes
    if (this.config.shapes) {
      this.app.workspace.onLayoutReady(() => {
        window.setTimeout(() => {
          this.sync_board_with_gamestate(false);
          this.cg.setShapes(this.config.shapes);
        }, 100);
      });
    }

    this.menu = new ChesserMenu(containerEl, this);
  }

  private set_style(el: HTMLElement, pieceStyle: string, boardStyle: string) {
    el.addClasses([pieceStyle, `${boardStyle}-board`, "chesser-container"]);
  }

  private get_section_range(): [EditorPosition, EditorPosition] {
    const sectionInfo = this.ctx.getSectionInfo(this.containerEl);

    return [
      {
        line: sectionInfo.lineStart + 1,
        ch: 0,
      },
      {
        line: sectionInfo.lineEnd,
        ch: 0,
      },
    ];
  }

  private write_config(config: Partial<ChesserConfig>) {
    debug(() => console.debug("writing config to localStorage", config));
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Chesser: Failed to retrieve active view");
      console.error("Chesser: Failed to retrieve view when writing config");
    }
    try {
      const updated = stringifyYaml({
        ...this.user_config,
        ...config,
      });

      const [from, to] = this.get_section_range();
      view.editor.replaceRange(updated, from, to);
    } catch (e) {
      // failed to parse. show error...
      console.error("failed to write config", e);
    }
  }

  private save_move() {
    this.app.workspace.onLayoutReady(() => {
      window.setImmediate(() => {
        this.write_config({
          currentMoveIdx: this.currentMoveIdx,
          pgn: this.chess.pgn(),
        });
      });
    });
  }

  private save_shapes(shapes: DrawShape[]) {
    this.app.workspace.onLayoutReady(() => {
      this.write_config({
        shapes,
      });
    });
  }

  private sync_board_with_gamestate(shouldSave: boolean = true) {
    this.cg.set({
      check: this.check(),
      turnColor: this.color_turn(),
      movable: {
        free: false,
        color: this.color_turn(),
        dests: this.dests(),
      },
    });

    this.menu?.redrawMoveList();
    if (shouldSave) {
      this.save_move();
    }
  }

  public color_turn(): Color {
    return this.chess.turn() === "w" ? "white" : "black";
  }

  public dests(): Map<Key, Key[]> {
    const dests = new Map();
    this.chess.SQUARES.forEach((s) => {
      const ms = this.chess.moves({ square: s, verbose: true });
      if (ms.length)
        dests.set(
          s,
          ms.map((m) => m.to)
        );
    });
    return dests;
  }

  public check(): boolean {
    return this.chess.in_check();
  }

  public undo_move() {
    this.update_turn_idx(this.currentMoveIdx - 1);
  }

  public redo_move() {
    this.update_turn_idx(this.currentMoveIdx + 1);
  }

  public update_turn_idx(moveIdx: number): void {
    if (moveIdx < -1 || moveIdx >= this.moves.length) {
      return;
    }

    const isUndoing = moveIdx < this.currentMoveIdx;
    if (isUndoing) {
      while (this.currentMoveIdx > moveIdx) {
        this.currentMoveIdx--;
        this.chess.undo();
      }
    } else {
      while (this.currentMoveIdx < moveIdx) {
        this.currentMoveIdx++;
        const move = this.moves[this.currentMoveIdx];
        this.chess.move(move);
      }
    }

    let lastMove: [Key, Key] = undefined;
    if (this.currentMoveIdx >= 0) {
      const move = this.moves[this.currentMoveIdx];
      lastMove = [move.from, move.to];
    }

    this.cg.set({
      fen: this.chess.fen(),
      lastMove,
    });
    this.sync_board_with_gamestate();
  }

  public setFreeMove(enabled: boolean): void {
    if (enabled) {
      this.cg.set({
        events: {
          move: this.save_move,
        },
        movable: {
          free: true,
          color: "both",
          dests: undefined,
        },
      });
    } else {
      this.cg.set({
        events: {
          move: (orig: any, dest: any) => {
            const move = this.chess.move({ from: orig, to: dest });
            this.currentMoveIdx++;
            this.moves = [...this.moves.slice(0, this.currentMoveIdx), move];
            this.sync_board_with_gamestate();
          },
        },
      });
      this.sync_board_with_gamestate();
    }
  }

  public turn() {
    return this.chess.turn();
  }

  public history() {
    return this.moves;
  }

  public flipBoard() {
    return this.cg.toggleOrientation();
  }

  public getBoardState() {
    return this.cg.state;
  }

  public getFen() {
    return this.chess.fen();
  }

  public loadFen(fen: string, moves?: string[]): void {
    let lastMove: [Key, Key] = undefined;
    if (moves) {
      this.currentMoveIdx = -1;
      this.moves = [];
      this.chess.reset();

      moves.forEach((fullMove) => {
        fullMove.split(" ").forEach((halfMove) => {
          const move = this.chess.move(halfMove);
          this.moves.push(move);
          this.currentMoveIdx++;
        });
      });

      if (this.currentMoveIdx >= 0) {
        const move = this.moves[this.currentMoveIdx];
        lastMove = [move.from, move.to];
      }
    } else {
      this.chess.load(fen);
    }

    this.cg.set({ fen: this.chess.fen(), lastMove });
    this.sync_board_with_gamestate();
  }
}
