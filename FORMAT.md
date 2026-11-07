# Zahlbar plan format (version 1)

A Zahlbar plan is an ordinary Markdown note. This file is the reference for reading and writing it by hand, or with a script or an AI agent.

## Recognising a plan

A note is a plan when its frontmatter has a `zahlbar` key. The value is the format version.

```yaml
---
zahlbar: 1
currency: DKK      # optional, shown with totals (e.g. "64 500 DKK/mo"). Also set from the plan menu in the pane
view: month        # optional: month | year
sort: manual       # optional: manual | amount
scale: amount      # optional: amount | percent
---
```

`view`, `sort` and `scale` are display preferences. The plugin writes them when you use its toggles.

## Sections

Entries live under four headings, at any heading level, matched without regard to case:

| Heading | Meaning |
|---|---|
| `Income` | Money coming in |
| `Tax` | Tax, on any income |
| `Savings` | Money set aside (or taken out, see negative amounts). `Saving` is also accepted |
| `Living` | Spending |

Any other heading ends the current section. Text outside these sections is ignored and kept as-is. So are prose, blank lines, nested bullets and code blocks inside them.

## Entries

One top-level bullet (`-`, `*` or `+`) per entry:

```
- <name>: <amount> [<how often>] [{<attribute>, ...}]
```

- **Name:** everything before the last `: <number>`, so names may contain colons.
- **Amount:** the amount each time it happens, not converted to monthly.
  - **Thousands separators:** a space, `,` or `.` followed by exactly three digits is a thousands separator. `42 000`, `42,000` and `42.000` all mean 42000.
  - **Decimals:** any other `,` or `.` is a decimal point (`12,5` and `12.5`).
  - **Shorthand:** `42k` = 42000.
  - **Written back** with spaces: `42 000`.
- **How often:** leave it out for monthly. Otherwise use one of:
  - `weekly`, `monthly`, `quarterly` (every 3 months), `half-yearly` (every 6 months), `yearly`
  - `daily`, `biweekly`
  - `every N days`, `every N weeks`, `every N months`, `every N years`
  - Short forms `/q`, `/y`, `/mo` are accepted when reading.
- **Hidden:** wrap the whole entry in `~~ ~~`. A hidden entry is kept but excluded from all totals.

### Attributes

Attributes go in braces at the end of the line, separated by commas. Unknown attributes are kept as-is.

| Attribute | On | Meaning |
|---|---|---|
| `shares` | Income | Received as shares, not cash |
| `pension` | Income | Paid into a pension for you, not cash |
| `shares` | Tax | Paid by selling shares (sell-to-cover), not from cash |
| `shares` / `pension` | Savings | Positive: the cash goes into shares or pension. Negative: taken out of shares or pension into cash |
| `beige` `cyan` `green` `lilac` `sand` `blue` `rose` `mint` `stone` `lavender` | any | Colour in the chart |

`cash` is the default and is never written.

### Negative amounts

Only Savings lines may be negative. A negative amount takes money out, e.g. selling shares:

```
- Sell shares: -5 000 quarterly {shares}
```

A negative amount anywhere else is reported as a line that couldn't be read.

## How totals are computed

All amounts are converted to a yearly value. The month view divides by 12.

| Total | Formula |
|---|---|
| Income | sum of Income |
| Cash in | Income without `shares` or `pension` |
| Cash out | Tax, Savings and Living, minus tax paid with `shares`. A negative Savings line reduces cash out |
| **Cash left over** | cash in − cash out (negative = shortfall) |
| **Kept as shares** | Income `shares` − Tax `shares` − shares sold (negative Savings `shares`) |
| **Kept as pension** | Income `pension` − pension taken out (negative Savings `pension`) |
| Tax rate | Tax ÷ Income |
| Saved | (Income − Tax − Living) ÷ Income |

These always add up: Income = Tax + positive Savings + Living + kept as shares + kept as pension + cash left over.

## Example

```markdown
---
zahlbar: 1
currency: DKK
---
# Plan 2027
%% Format: https://github.com/bjarkeaf/Zahlbar/blob/main/FORMAT.md %%

## Income
- Salary: 50 000
- Stock vest: 30 000 quarterly {shares}
- Employer pension: 4 000 {pension}

## Tax
- Income tax: 18 000
- Tax on vest: 12 000 quarterly {shares}

## Savings
- Stock purchase plan: 5 000 {shares}
- Own pension: 2 000 {pension}
- Sell shares: -3 000 quarterly {shares}

## Living
- Rent: 9 500
- ~~Car: 3 000~~
- Haircut: 450 every 6 weeks
```
