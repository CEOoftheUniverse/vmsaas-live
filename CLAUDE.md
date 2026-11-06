# Working agreement for Claude in this repository

## Standing rule from the owner: be proactive on every task (set 2026-11-06)

The owner asked for this to apply "forever and ever for every task". In practice:

1. **Act, don't ask.** If a task has a sensible default, pick it, say which one in one line, and keep going. Never end a turn with a question you could answer yourself.
2. **Finish the whole job.** After the requested step, do the obvious next steps without waiting to be told: tests and QA, links, sitemap, docs, cleanup, and a pull request with a clear description.
3. **Fix what you find.** When you notice a related problem (a broken link, a false claim, a dead form, a wrong price), fix it on the same branch and list it in the pull request.
4. **Go big when it helps.** Run research, writing and review in parallel (workflows, several agents) and check claims adversarially before shipping.
5. **Report like a dashboard.** Lead with what changed, then tables (with % ratings where useful), metric units, and clickable links for every company or source.

### The short list that still waits for the owner's explicit OK

Everything else: just do it. These few stay gated because they are hard to undo or act in the owner's name:

- spending money, starting paid plans or signing up for services;
- sending email or messages, posting publicly, or contacting companies or people;
- merging to `main` or anything else that goes live (GitHub Pages deploys from `main`);
- deleting data, force-pushing or rewriting history;
- secrets and credentials (never commit them);
- new legal or commercial promises on the public site (prices, refunds, SLAs): draft them, flag them in the pull request, and let the owner merge.

## Repo facts worth knowing

- Static site "MoltBot Cloud", served by GitHub Pages from `main`: https://ceooftheuniverse.github.io/vmsaas-live/ . The product is in pre-order.
- An auto-blog bot ("Antigravity OS") commits to `main` and can regenerate pages such as `ai-agents-24-7-hosting.html`.
- Every form submits through `leads.js`. Paste one endpoint into `LEADS_ENDPOINT` (Formspree, Supabase or a redeployed backend) to start saving leads; until then the forms show an honest "inbox is being set up" message. The old Vercel backend (`moltbot-cloud-saas.vercel.app`) no longer exists.
- Plan and GPU wording follows `pricing.html` (shared GPU-hours per plan, dedicated GPUs at market rate + 10%, 7-day trial at launch). Keep every page consistent with it.
- For new pages, start from `space-data-center-cost-calculator.html` or one of the `blog-space-*.html` articles: tables wrapped in `.tw`, a phone-friendly nav, JSON-LD, and every outside number linked to its source.
- Work on `claude/*` branches and open draft pull requests.
