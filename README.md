# Zahlbar

Simple financial planner plugin for Obsidian that visualizes income and expenses as two bars. Your plans are stored as human-readable Markdown files.

The name is German for payable, and also reads as *Zahl* (number) plus bar.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img alt="Zahlbar in Obsidian, showing the example plan" src="docs/screenshot-light.png">
</picture>

## Install

Zahlbar isn't in the community plugin list yet. Download `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/zahlbar/` and enable it under Community plugins. To build it yourself, run `npm install && npm run build`.

## Try it

Copy [examples/Example plan.md](examples/Example%20plan.md) into your vault and run **Zahlbar: Open plan**. Edits in the pane go straight into the note, and edits in the note show up in the pane. Double-click a swatch to hide a line, drag a row to reorder it, and hover the chart to see where a number comes from.

## Writing a plan

A plan is a note with `zahlbar: 1` in its frontmatter and four headings: Income, Tax, Savings and Living. Each bullet is one entry.

```markdown
---
zahlbar: 1
currency: EUR
---
## Income
- Salary: 6 000
- Stock vest: 4 000 quarterly {shares}
- Employer pension: 500 {pension}

## Tax
- Income tax: 2 200
- Tax on vest: 1 600 quarterly {shares}

## Savings
- Sell shares: -1 000 quarterly {shares}

## Living
- Rent: 1 300
- ~~Car: 400~~
```

Amounts are per occurrence and monthly unless you say otherwise. `{shares}` and `{pension}` mark money you can't spend, and on a tax line `{shares}` means it's paid by selling shares. A negative Savings line takes money out. Strike a line through to leave it out of the totals. [FORMAT.md](FORMAT.md) has the full syntax and how the totals are calculated.

## Licence

MIT
