---
title: Privacy and redaction
description: What CrxTrace sends, what it scrubs before sending, and how to tighten the defaults further.
---

An error tracker running in a content script is one bad default away from being
a browsing-history collector. CrxTrace's defaults are deliberately strict, and
all redaction runs **in the browser, before anything is sent** — not on the
server after the fact.

## What gets scrubbed automatically

Every event passes through redaction on its way out:

| Scrubbed | Examples |
| --- | --- |
| JWTs | `eyJhbGciOi...` in any string |
| Bearer tokens | `Authorization: Bearer ...` |
| API-key shapes | `sk_live_...`, `pk_test_...` |
| Email addresses | in messages, breadcrumbs, and extra data |
| Sensitive-looking keys | any value under a key matching `pass`, `secret`, `token`, `auth`, `key`, `cookie`, `session`, or `credential` |

That last rule is a structural one — it catches `{ password: ... }`,
`{ apiKey: ... }`, `{ sessionToken: ... }` and so on without you enumerating
them.

## URLs are truncated

URLs are reduced to **origin + path**. Query strings and fragments are dropped:

```
https://app.example.com/orders/1234?token=abc&email=x@y.com#section
→ https://app.example.com/orders/1234
```

Query strings are where credentials and personal data most often hide, and you
almost never need them to fix a bug.

To keep them, opt in explicitly:

```js
CrxTrace.init({ dsn: "...", sendDefaultPii: true });
```

Think carefully before doing this in a content script. It means collecting the
full URLs of pages your users visit.

## What is always sent

For transparency, an envelope carries:

- The error: type, message, stack frames, and which surface it came from
- Your extension's id, name, version, and manifest version
- Browser name and version, platform, and UI language
- A random `installId` — generated locally, not derived from anything about
  the user, and used only to count distinct affected installs
- Breadcrumbs you or the auto-instrumentation recorded
- Tags, contexts, and user fields **you** set

There is no fingerprinting, no ad identifier, and no cross-site correlation.
The full shape is documented in the [envelope reference](/reference/envelope/).

## What you control

### Don't collect from certain sites

```js
CrxTrace.init({
  dsn: "...",
  denyHosts: [/bank/, "internal.corp", /\.gov$/],
});
```

### Scrub your own patterns

```js
CrxTrace.init({
  dsn: "...",
  scrub: [/ORDER-\d+/, /account-[a-z0-9]{12}/],
});
```

### Inspect and drop anything

`beforeSend` is the last thing to run. Return `null` to drop the event
entirely:

```js
CrxTrace.init({
  dsn: "...",
  beforeSend: (event) => {
    if (event.host === "sensitive.example.com") return null;
    delete event.contexts.extra?.rawResponse;
    return event;
  },
});
```

### Identify users only if you need to

`setUser()` is opt-in and sends nothing unless you call it:

```js
CrxTrace.setUser({ id: internalAccountId });   // prefer an opaque id
```

Passing an `email` here will send that email — the redaction rules deliberately
don't strip fields you set intentionally. If you don't need to identify people,
don't.

### Auto-breadcrumbs

`console.error`/`warn`, `fetch`, and `runtime.sendMessage` are instrumented by
default. Breadcrumbs pass through the same redaction as everything else, but if
you'd rather record nothing automatically:

```js
CrxTrace.init({ dsn: "...", autoBreadcrumbs: false });
```

## Chrome Web Store disclosure

Using CrxTrace means your extension transmits data, and the Web Store requires
you to declare that. With default settings, the honest description is roughly:

> Collects crash and error diagnostics — error messages, stack traces,
> extension version, browser version, and the domain on which an error
> occurred — to identify and fix defects.

Under default settings you are **not** collecting personally identifiable
information, browsing history, or user content. If you enable
`sendDefaultPii`, or call `setUser()` with an email, that stops being true and
your disclosure must change.

Point your privacy policy at your own endpoint and retention policy — CrxTrace
is a library, so where events go and how long they're kept is your decision,
not ours.

## Verifying for yourself

Don't take the above on trust — watch the traffic:

```bash
npm run demo:ingest
```

Every envelope is printed in full as it arrives. You can also read
[`src/redact.ts`](https://github.com/sabbir-offc/crxtrace/blob/main/src/redact.ts)
— it's about 60 lines.

## Related

- [Filtering events](/guides/filtering/)
- [Self-hosting](/reference/self-hosting/) — keep the data entirely on your own infrastructure
