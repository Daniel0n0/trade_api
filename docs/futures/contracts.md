# Futures contract cache

The futures modules watch Robinhood's JSON responses to learn which contract
codes are active. Whenever the overview or detail runners encounter a symbol
that matches the canonical futures pattern (e.g. `MESZ25`, `MNQZ25`), the code
is merged into a persistent cache stored at
`state/futures/known-contracts.json`.

The file keeps a sorted list of contract codes and the timestamp of the last
update:

```json
{
  "updatedAt": "2024-10-30T12:45:00.000Z",
  "symbols": ["MESZ25", "MNQZ25"]
}
```

## Reviewing the cache

Open `state/futures/known-contracts.json` in your editor or run
`cat state/futures/known-contracts.json` to inspect the most recently observed
contracts. New symbols discovered during a module run are logged in the console
and appended to this file automatically.

## Resetting the cache

Delete the JSON file to clear the list and force the next module execution to
reseed it from the default symbols:

```bash
rm -f state/futures/known-contracts.json
```

The overview and detail runners will add back any contracts they see in the UI
or API responses, so you can reset the cache at any time without changing the
code.
