# Zahlbar

An Obsidian plugin for planning where your money goes. You write recurring income and outgoings in a plain Markdown note, and Zahlbar draws them as two stacked bars, **Income** and **Outgoings**, per month or per year.

It is a forward-looking plan, not a ledger. There are no transactions, no bank import and no network calls. Your figures stay in your vault.

## The note

A plan is any note with `zahlbar: 1` in its frontmatter:

```markdown
---
zahlbar: 1
currency: DKK
---
# Plan 2027

## Income
- Salary: 50 000
- Stock vest: 30 000 quarterly {shares}
- Employer pension: 4 000 {pension}

## Tax
- Income tax: 18 000
- Tax on vest: 12 000 quarterly {shares}

## Saving
- Stock purchase plan: 5 000

## Living
- Rent: 9 500
- ~~Car: 3 000~~
- Haircut: 450 every 6 weeks
```

- **Entries:** one per bullet, written as `name: amount [how often] [{attributes}]`, under the headings `Income`, `Tax`, `Saving` and `Living`.
- **Amounts:** the amount each time it happens. `42 000`, `42,000`, `42.000` and `42k` all work.
- **How often:**
  - Leave it out for monthly.
  - Presets: `weekly`, `quarterly`, `half-yearly`, `yearly`.
  - Anything else: `every N days|weeks|months|years`.
- **Attributes:**
  - `{shares}` or `{pension}` on income means money you can't spend. Shares are drawn with diagonal lines and pension with dots, the same on both bars and in the list.
  - `{shares}` on a tax line means the tax is paid by selling shares (sell-to-cover).
  - `{shares}` or `{pension}` on a saving line says what the money goes into. It's still paid from cash, so cash left over doesn't change.
  - A negative saving line takes money out, e.g. `- Sell shares: -5 000 {shares}`. Kept as shares drops and cash left over rises by the same amount. If you sell more than you receive, the extra shows as "From shares you hold" on top of Income. The same works for `{pension}` or for cash savings. Only Saving lines can be negative. The swatch popover has a Buy/Sell toggle (Pay in/Take out for pension, Save/Withdraw for cash) that flips the sign.
  - A colour name like `{rose}` picks the colour.
- **Hidden entries:** strike through (`~~ ~~`) to hide an entry. It stays in the note but is left out of every total.
- **Everything else** in the note (prose, other headings, nested bullets) is left alone. A bullet Zahlbar can't read is listed at the bottom of the pane, so you can fix it.

## The pane

Run **Zahlbar: Open plan** or click the piggy bank in the ribbon.

**List**
- Click a name or amount to edit it. You can type the frequency straight into the amount, e.g. `120k yearly`.
- Pick how often from the dropdown, or choose `custom…`.
- Drag a row by the empty space after its name to reorder it.
- Double-click a swatch to hide or show the entry.
- Click a swatch to set its colour and kind of money: received as (income), paid with (tax), or goes into (saving).

**Chart**
- Hover a row or a segment to see the two linked.
- Thin segments merge into "N small items". Hover to see what's inside.
- **Outgoings** stacks tax, saving and living, then any spare cash ("Left over", outlined).
- Shares and pension you receive and keep count as saving. They're shown separately, since they usually become available on different timescales:
  - **Kept as shares** has lines, after any tax paid by selling shares.
  - **Kept as pension** has dots.
- If cash runs short, a red "short" block sits on top of Income.
- Hover a computed segment (kept as shares, kept as pension, cash left over, shortfall) to see how it's calculated, and the lines it comes from light up. Click to keep the breakdown open, then click a line to edit it.

**Toggles**
- **Month | Year**: the month view averages anything that isn't monthly.
- **As written | Largest first**: sorts the display by yearly value. The note keeps its own order.

**Metrics** at the bottom:
- **Cash left over:** cash in minus cash out.
- **Tax rate:** tax ÷ income.
- **Saved:** income minus tax and living, as a share of income, counting shares and pension.

Every change is written straight to the note, one line at a time. Edits you make in the note show up in the pane.

## Development

```bash
npm install
npm run build          # main.js
npm test               # core unit tests (vitest)
npm run harness        # the real pane in headless Chromium, driven with real input
npm run install:vault -- "/path/to/vault"
```

`src/core` is pure TypeScript (parse, write, compute) with no Obsidian imports. `src/obsidian` is the plugin. `harness/` runs the real view against a stubbed `obsidian` module and an in-memory vault. `node harness/run.mjs --shots` also saves screenshots to `harness/dist/`.

## Licence

MIT
