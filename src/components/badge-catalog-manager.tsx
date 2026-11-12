"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { Award, ChevronLeft, ChevronRight, Layers, LoaderCircle, RefreshCw, Search } from "lucide-react";
import {
  loadBadgeCatalogAction,
  updateBadgeCatalogCategoryAction,
} from "@/app/admin/badge-sync-actions";
import {
  initialBadgeCatalogActionState,
  type BadgeCatalogRow,
} from "@/app/admin/badge-sync-state";
import { isCategoryAllowedForBadgeKey, type CatalogCategory } from "@/lib/badges/catalog";

type CatalogFilter = "all" | "skill" | "arcade" | "ignored";
const PAGE_SIZE = 20;
const CATEGORY_ORDER: CatalogCategory[] = ["skill", "arcade", "ignored"];

const catalogFilters: { id: CatalogFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "skill", label: "Skill" },
  { id: "arcade", label: "Arcade" },
  { id: "ignored", label: "Ignored" },
];

function categoryOptions(entry: BadgeCatalogRow): CatalogCategory[] {
  const allowed = CATEGORY_ORDER.filter((category) => isCategoryAllowedForBadgeKey(entry.badgeKey, category));
  if (!allowed.includes(entry.category)) return [entry.category, ...allowed];
  return allowed;
}

function structuralLabel(badgeKey: string) {
  return badgeKey.startsWith("game:") ? "Arcade family" : "Skill family";
}

export function BadgeCatalogManager() {
  const [entries, setEntries] = useState<BadgeCatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [page, setPage] = useState(0);
  const [updateState, updateAction, updatePending] = useActionState(
    updateBadgeCatalogCategoryAction,
    initialBadgeCatalogActionState,
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadBadgeCatalogAction().then((state) => {
      if (!active) return;
      if (state.status === "error") {
        setLoadError(state.message);
        setLoading(false);
        return;
      }
      setEntries(state.entries ?? []);
      setLoadError(null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  useEffect(() => {
    if (updateState.status === "success" && updateState.entries) {
      setEntries(updateState.entries);
    }
  }, [updateState]);

  useEffect(() => {
    setPage(0);
  }, [query, filter]);

  const counts = useMemo(() => {
    const next: Record<CatalogFilter, number> = { all: entries.length, skill: 0, arcade: 0, ignored: 0 };
    for (const entry of entries) {
      if (entry.category === "skill" || entry.category === "arcade" || entry.category === "ignored") {
        next[entry.category] += 1;
      }
    }
    return next;
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      const matchesFilter = filter === "all" || entry.category === filter;
      const matchesQuery = !needle
        || entry.displayName.toLocaleLowerCase().includes(needle)
        || entry.badgeKey.toLocaleLowerCase().includes(needle)
        || entry.source.toLocaleLowerCase().includes(needle);
      return matchesFilter && matchesQuery;
    });
  }, [entries, filter, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE);

  return (
    <article className="admin-panel admin-catalog-panel">
      <div className="admin-panel-heading admin-catalog-heading">
        <span className="admin-panel-icon">
          <Layers size={16} aria-hidden="true" />
        </span>
        <div>
          <p className="admin-panel-eyebrow">CATALOG MANAGEMENT</p>
          <h3>Badge identities</h3>
        </div>
        <button
          type="button"
          className="badge-sync-secondary"
          onClick={() => setReloadToken((current) => current + 1)}
          disabled={loading}
        >
          {loading ? <LoaderCircle size={14} className="auth-spinner" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
          Refresh
        </button>
      </div>

      <div className="admin-catalog-toolbar">
        <label className="admin-directory-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search the badge catalog</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by badge name, identity, or source"
          />
        </label>
        <div className="badge-sync-chips" role="group" aria-label="Catalog category filters">
          {catalogFilters.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="badge-sync-chip"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label} ({counts[id]})
            </button>
          ))}
        </div>
      </div>

      {updateState.status !== "idle" && (
        <p
          className={`badge-sync-inline-feedback ${updateState.status}`}
          role={updateState.status === "error" ? "alert" : "status"}
        >
          {updateState.message}
        </p>
      )}

      {loading ? (
        <div className="admin-panel-empty" role="status">
          <span><LoaderCircle size={17} className="auth-spinner" aria-hidden="true" /></span>
          <p>Loading catalog identities…</p>
          <small>The managed catalog is read through the existing audited admin action.</small>
        </div>
      ) : loadError ? (
        <div className="admin-feedback error" role="alert">
          <p>{loadError}</p>
          <small>The catalog was not changed. Refresh to try again.</small>
        </div>
      ) : filtered.length === 0 ? (
        <div className="admin-panel-empty" role="status">
          <span><Award size={17} aria-hidden="true" /></span>
          <p>No catalog identities match</p>
          <small>Change the search text or category filter to see more rows.</small>
          <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button>
        </div>
      ) : (
        <>
          <div className="admin-directory-table-wrap">
            <table className="admin-directory-table admin-catalog-table">
              <thead>
                <tr>
                  <th scope="col">BADGE</th>
                  <th scope="col">IDENTITY</th>
                  <th scope="col">CATEGORY</th>
                  <th scope="col">RECLASSIFY</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr key={entry.badgeKey}>
                    <td>
                      <strong>{entry.displayName}</strong>
                      <small>{entry.source}</small>
                    </td>
                    <td className="admin-catalog-key">
                      <code>{entry.badgeKey}</code>
                      <small>{structuralLabel(entry.badgeKey)}</small>
                    </td>
                    <td>
                      <span className={`admin-catalog-category ${entry.category}`}>{entry.category}</span>
                    </td>
                    <td>
                      <form action={updateAction} className="badge-sync-classifier-form admin-catalog-form">
                        <input type="hidden" name="badgeKey" value={entry.badgeKey} />
                        <input type="hidden" name="displayName" value={entry.displayName} />
                        <label>
                          <span className="sr-only">Category for {entry.badgeKey}</span>
                          <select name="category" defaultValue={entry.category} disabled={updatePending}>
                            {categoryOptions(entry).map((category) => (
                              <option key={category} value={category}>{category}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="sr-only">Reason for reclassifying {entry.badgeKey}</span>
                          <input
                            name="reason"
                            required
                            minLength={1}
                            maxLength={1000}
                            placeholder="Audited reason"
                            disabled={updatePending}
                          />
                        </label>
                        <button type="submit" disabled={updatePending}>
                          {updatePending ? "Saving…" : "Save"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-pagination" role="navigation" aria-label="Catalog pages">
            <span>{filtered.length === 0 ? "No identities" : `Showing ${rangeStart}–${rangeEnd} of ${filtered.length}`}</span>
            <div className="admin-pagination-controls">
              <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={safePage <= 0} aria-label="Previous catalog page">
                <ChevronLeft size={14} aria-hidden="true" />Previous
              </button>
              <span>Page {safePage + 1} / {pageCount}</span>
              <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={safePage >= pageCount - 1} aria-label="Next catalog page">
                Next<ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}

      <p className="admin-help">
        Category changes are catalog-wide and audited. Course templates can be Skill or ignored; games can be Arcade or ignored.
      </p>
    </article>
  );
}
