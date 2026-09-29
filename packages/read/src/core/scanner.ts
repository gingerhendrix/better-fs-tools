import type { ReadRequest } from "../contract/input.ts";
import type { ReadLimits } from "../contract/limits.ts";
import type { ReadLine } from "../contract/result.ts";
import type { ScanBudget } from "./budget.ts";

const ENCODER = new TextEncoder();

export type SelectionStop = "lines" | "bytes" | "budget" | null;

export class LineScanner {
  readonly lines: ReadLine[] = [];
  totalLines = 0;
  viewBytes = 0;
  selectionStop: SelectionStop = null;
  firstUnshown: number | null = null;

  private budgetUsed = 0;
  private linePrefix = "";
  private lineChars = 0;
  private lineHasContent = false;
  private pendingCr = false;

  constructor(
    private readonly request: ReadRequest,
    private readonly limits: Readonly<ReadLimits>,
    private readonly budget: ScanBudget | null = null,
  ) {}

  push(text: string): void {
    for (const character of text) {
      if (this.pendingCr) {
        this.emitLine();
        this.pendingCr = false;
        if (character === "\n") continue;
      }
      if (character === "\r") {
        this.pendingCr = true;
      } else if (character === "\n") {
        this.emitLine();
      } else {
        this.lineHasContent = true;
        this.lineChars += 1;
        if (this.lineChars <= this.limits.maxCharsPerLine && this.retainingCurrentLine()) {
          this.linePrefix += character;
        }
      }
    }
  }

  finish(): void {
    if (this.pendingCr) {
      this.emitLine();
      this.pendingCr = false;
    } else if (this.lineHasContent) {
      this.emitLine();
    }
  }

  stopAtScanLimit(unscannedBytesKnown: boolean): void {
    if (this.pendingCr) {
      this.emitLine();
      this.pendingCr = false;
      if (unscannedBytesKnown && this.firstUnshown === null) {
        const nextLine = this.totalLines + 1;
        if (nextLine >= this.request.offset) this.firstUnshown = nextLine;
      }
      return;
    }
    if ((this.lineHasContent || unscannedBytesKnown) && this.firstUnshown === null) {
      const currentLine = this.totalLines + 1;
      if (currentLine >= this.request.offset) this.firstUnshown = currentLine;
    }
  }

  get clampedLines(): readonly number[] {
    return this.lines.filter((line) => line.clamped).map((line) => line.number);
  }

  get viewText(): string {
    return this.lines.map((line) => line.text).join("\n");
  }

  private retainingCurrentLine(): boolean {
    return this.totalLines + 1 >= this.request.offset && this.selectionStop === null;
  }

  private admitByBudget(): boolean {
    if (this.budget === null) return true;
    const cost = this.budget.measure(this.linePrefix);
    // The first line is always admitted, so a budget alone never gives an empty view.
    if (this.lines.length > 0 && this.budgetUsed + cost > this.budget.max) return false;
    this.budgetUsed += cost;
    return true;
  }

  private emitLine(): void {
    this.totalLines += 1;
    const number = this.totalLines;
    if (number >= this.request.offset && this.selectionStop === null) {
      if (this.lines.length >= this.request.limit) {
        this.selectionStop = "lines";
        this.firstUnshown = number;
      } else {
        const clamped = this.lineChars > this.limits.maxCharsPerLine;
        const separatorBytes = this.lines.length === 0 ? 0 : 1;
        const candidateBytes = ENCODER.encode(this.linePrefix).byteLength + separatorBytes;
        if (this.viewBytes + candidateBytes > this.limits.maxViewBytes) {
          this.selectionStop = "bytes";
          this.firstUnshown = number;
        } else if (!this.admitByBudget()) {
          this.selectionStop = "budget";
          this.firstUnshown = number;
        } else {
          this.lines.push({
            number,
            text: this.linePrefix,
            clamped,
            sourceChars: clamped ? this.lineChars : null,
          });
          this.viewBytes += candidateBytes;
        }
      }
    }
    this.linePrefix = "";
    this.lineChars = 0;
    this.lineHasContent = false;
  }
}
