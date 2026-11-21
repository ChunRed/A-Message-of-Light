"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  fetchLibraryImages,
  LibraryImageItem,
  MailboxNumber,
} from "@/lib/image-library-api";
import { DownloadIcon } from "@/components/LetterIcons";

interface LetterLibraryViewProps {
  /** Strictly locked to a single mailbox (1..6) from `?post=1..6` */
  mailbox: MailboxNumber;
  onWriteForMailbox?: (mailbox: MailboxNumber) => void;
  onClose: () => void;
  /** Increment to force-refresh when a new image was just uploaded */
  refreshSignal?: number;
}

const PAGE_LIMIT = 24;

function formatItemDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

export function LetterLibraryView({
  mailbox,
  onWriteForMailbox,
  onClose,
  refreshSignal = 0,
}: LetterLibraryViewProps) {
  const [items, setItems] = useState<LibraryImageItem[]>([]);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const loadPage = useCallback(
    async (
      targetPage: number,
      append: boolean,
      targetMailbox: MailboxNumber,
      signal?: AbortSignal
    ) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsInitialLoading(true);
      }
      setErrorMsg(null);

      try {
        const res = await fetchLibraryImages(
          targetPage,
          PAGE_LIMIT,
          targetMailbox,
          signal
        );
        if (signal?.aborted) return;

        setItems((prev) => {
          if (!append) return res.items;
          const seen = new Set(prev.map((it) => String(it.id ?? it.key)));
          const merged = [...prev];
          for (const item of res.items) {
            const uid = String(item.id ?? item.key);
            if (!seen.has(uid)) {
              seen.add(uid);
              merged.push(item);
            }
          }
          return merged;
        });

        setPage(targetPage);
        setHasMore(res.items.length >= PAGE_LIMIT);
      } catch (err) {
        if (signal?.aborted) return;
        setErrorMsg(
          err instanceof Error ? err.message : "無法載入郵筒信件，請稍後再試"
        );
      } finally {
        if (!signal?.aborted) {
          setIsInitialLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    []
  );

  // Load ONLY the locked mailbox's images whenever `mailbox` or `refreshSignal` changes
  useEffect(() => {
    const controller = new AbortController();

    async function fetchFirstPage() {
      try {
        const res = await fetchLibraryImages(
          1,
          PAGE_LIMIT,
          mailbox,
          controller.signal
        );
        if (controller.signal.aborted) return;
        setItems(res.items);
        setPage(1);
        setHasMore(res.items.length >= PAGE_LIMIT);
        setErrorMsg(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setErrorMsg(
          err instanceof Error ? err.message : "無法載入郵筒信件，請稍後再試"
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsInitialLoading(false);
        }
      }
    }

    void fetchFirstPage();
    return () => controller.abort();
  }, [mailbox, refreshSignal]);

  // Keyboard navigation for Lightbox & ESC to close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedIndex !== null) {
          setSelectedIndex(null);
        } else {
          onClose();
        }
      } else if (selectedIndex !== null) {
        if (e.key === "ArrowLeft") {
          setSelectedIndex((prev) =>
            prev !== null && prev > 0 ? prev - 1 : prev
          );
        } else if (e.key === "ArrowRight") {
          setSelectedIndex((prev) =>
            prev !== null && prev < items.length - 1 ? prev + 1 : prev
          );
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items.length, onClose, selectedIndex]);

  const handleLoadMore = () => {
    if (isLoadingMore || !hasMore) return;
    void loadPage(page + 1, true, mailbox);
  };

  const handleRefresh = () => {
    setSelectedIndex(null);
    void loadPage(1, false, mailbox);
  };

  const selectedItem =
    selectedIndex !== null ? items[selectedIndex] ?? null : null;

  return (
    <div
      role="region"
      aria-label={`郵筒 ${mailbox} 信件瀏覽`}
      className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden bg-[#FCFBFA] text-[#222222]"
    >
      {/* Subtle cotton paper grain overlay */}
      <div
        aria-hidden="true"
        className="paper-grain-overlay pointer-events-none fixed inset-0 z-0 opacity-[0.045]"
      />

      {/* Sticky Minimalist Hand-Drawn Header (Locked to Single Mailbox, NO QR / NO Switcher) */}
      <header className="relative z-10 shrink-0 border-b border-dashed border-[#222222]/20 bg-[#FDFCF9]/92 px-3 py-3 backdrop-blur-[3px] sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="sketch-pill inline-flex h-8 items-center gap-1.5 border border-[#222222] bg-white px-3.5 text-xs font-normal tracking-[0.14em] text-[#222222] transition-colors hover:bg-[#FAF9F6] active:scale-[0.97]"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7.6 2.2C6.2 3.5 5 4.8 3.6 6C5 7.2 6.3 8.5 7.6 9.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>返回寄信主頁</span>
          </button>

          <div className="flex flex-col items-center text-center">
            <h1 className="text-sm font-normal tracking-[0.24em] text-[#222222] sm:text-base">
              郵筒 {mailbox} · 光之信箱
            </h1>
            <span className="font-mono text-[9px] tracking-[0.22em] text-[#8C8C8A]">
              MAILBOX POST #{mailbox}
            </span>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            disabled={isInitialLoading}
            className="sketch-pill inline-flex h-8 items-center gap-1.5 border border-[#222222]/30 bg-white px-3 text-[11px] font-normal tracking-[0.12em] text-[#222222] transition-colors hover:border-[#222222] hover:bg-[#FAF9F6] active:scale-[0.97] disabled:opacity-40"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              className={isInitialLoading ? "animate-spin" : ""}
              aria-hidden="true"
            >
              <path
                d="M11.6 7A4.6 4.6 0 1 1 10.2 3.7M10.5 1.8V4H8.3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="hidden sm:inline">重新整理</span>
          </button>
        </div>
      </header>

      {/* Scrollable Responsive Gallery Grid */}
      <main className="relative z-10 flex-1 overflow-y-auto px-3 py-5 sm:px-6 sm:py-7">
        <div className="mx-auto w-full max-w-[1160px]">
          {/* Error Banner */}
          {errorMsg && (
            <div className="sketch-card mx-auto mb-6 flex max-w-[460px] flex-col items-center border border-[#222222] bg-[#FDFCF9] px-5 py-5 text-center">
              <p className="text-xs font-normal tracking-[0.14em] text-[#222222]">
                {errorMsg}
              </p>
              <p className="mt-1 font-mono text-[9.5px] tracking-[0.1em] text-[#8C8C8A]">
                請確認後端 Server 已啟動且 API 網址正確
              </p>
              <button
                type="button"
                onClick={handleRefresh}
                className="sketch-pill mt-3.5 border border-[#222222] bg-[#222222] px-4 py-1.5 text-xs tracking-[0.16em] text-[#FAF9F6] transition-colors hover:bg-white hover:text-[#222222]"
              >
                重新載入
              </button>
            </div>
          )}

          {/* Initial Skeleton Grid (min 2 columns on mobile) */}
          {isInitialLoading && items.length === 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div
                  key={idx}
                  className="sketch-card flex flex-col border border-[#222222]/15 bg-[#FAF9F6] p-2"
                >
                  <div className="aspect-[3/4] w-full animate-pulse bg-[#ECECE7]" />
                  <div className="mt-2 h-2.5 w-16 animate-pulse bg-[#ECECE7]" />
                </div>
              ))}
            </div>
          )}

          {/* Empty State (Strictly Isolated to Current Mailbox) */}
          {!isInitialLoading && !errorMsg && items.length === 0 && (
            <div className="sketch-card mx-auto my-12 flex max-w-[360px] flex-col items-center border border-[#222222] bg-[#FDFCF9] px-6 py-8 text-center">
              <p className="text-sm font-normal tracking-[0.2em] text-[#222222]">
                郵筒 {mailbox} 尚無收錄信紙
              </p>
              <p className="mt-2 text-xs font-light leading-relaxed tracking-[0.1em] text-[#8C8C8A]">
                這個郵筒目前還沒有收到信件，你可以回到寄信主頁寫一封信投入郵筒{" "}
                {mailbox}。
              </p>
              <div className="mt-5 flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => {
                    if (onWriteForMailbox) {
                      onWriteForMailbox(mailbox);
                    } else {
                      onClose();
                    }
                  }}
                  className="sketch-pill border border-[#222222] bg-[#222222] px-4 py-1.5 text-xs tracking-[0.16em] text-[#FAF9F6] transition-colors hover:bg-white hover:text-[#222222]"
                >
                  寫信投入郵筒 {mailbox}
                </button>
              </div>
            </div>
          )}

          {/* Responsive Image Grid: Minimum 2 columns on mobile */}
          {items.length > 0 && (
            <>
              <div className="mb-3.5 flex items-center justify-between font-mono text-[10px] tracking-[0.16em] text-[#8C8C8A]">
                <span>
                  POST #{mailbox} · {items.length} LETTERS
                </span>
                <span>PAGE {String(page).padStart(2, "0")}</span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
                {items.map((item, idx) => {
                  const dateLabel = formatItemDate(item.created_at);
                  return (
                    <button
                      key={String(item.id ?? item.key)}
                      type="button"
                      onClick={() => setSelectedIndex(idx)}
                      className="sketch-card group flex flex-col overflow-hidden border border-[#222222]/25 bg-[#FDFCF9] p-1.5 text-left transition-all duration-250 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:border-[#222222] active:scale-[0.98] sm:p-2"
                    >
                      <div className="relative aspect-[3/4] w-full overflow-hidden border border-[#222222]/10 bg-[#FAF9F6]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={`郵筒 ${mailbox} 光的訊息 #${idx + 1}`}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between px-0.5 font-mono text-[9px] tracking-[0.12em] text-[#8C8C8A]">
                        <span>NO.{String(idx + 1).padStart(3, "0")}</span>
                        {dateLabel && <span>{dateLabel}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Load More / Pagination Footer */}
              <div className="mt-8 mb-6 flex flex-col items-center gap-2">
                {hasMore ? (
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="sketch-pill inline-flex h-9 items-center gap-2 border border-[#222222] bg-[#FDFCF9] px-6 text-xs font-normal tracking-[0.18em] text-[#222222] transition-all duration-200 hover:bg-[#222222] hover:text-[#FAF9F6] active:scale-[0.98] disabled:opacity-50"
                  >
                    {isLoadingMore ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                        <span>載入更多中…</span>
                      </>
                    ) : (
                      <span>載入更多</span>
                    )}
                  </button>
                ) : (
                  <span className="font-mono text-[10px] tracking-[0.2em] text-[#8C8C8A]">
                    — POST #{mailbox} · 共 {items.length} 則光的訊息 —
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ================================================================= */}
      {/* FULL-SCREEN LIGHTBOX FOR ZOOMED IMAGE INSPECTION                  */}
      {/* ================================================================= */}
      {selectedItem && selectedIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="放大檢視信紙圖片"
          onClick={() => setSelectedIndex(null)}
          className="fixed inset-0 z-60 flex items-center justify-center bg-[#0B0B0D]/90 px-3 py-6 backdrop-blur-[4px] sm:px-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-muji-modal-in relative flex max-h-[92dvh] w-full max-w-[680px] flex-col items-center"
          >
            {/* Top Bar inside Lightbox */}
            <div className="mb-3 flex w-full items-center justify-between text-[#FAF9F6]">
              <div className="font-mono text-[10px] tracking-[0.18em] text-[#D4D4CE]">
                NO.{String(selectedIndex + 1).padStart(3, "0")} /{" "}
                {String(items.length).padStart(3, "0")} · POST #{mailbox}
                {selectedItem.created_at
                  ? ` · ${formatItemDate(selectedItem.created_at)}`
                  : ""}
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={selectedItem.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={`light-message-post${mailbox}-${selectedIndex + 1}.webp`}
                  className="sketch-pill-dark inline-flex h-8 items-center gap-1.5 border border-[#FAF9F6]/60 bg-transparent px-3 text-[11px] tracking-[0.12em] text-[#FAF9F6] transition-colors hover:border-[#FAF9F6] hover:bg-[#FAF9F6]/12"
                >
                  <DownloadIcon size={13} />
                  <span>原圖</span>
                </a>

                <button
                  type="button"
                  onClick={() => setSelectedIndex(null)}
                  aria-label="關閉放大檢視"
                  className="sketch-pill-dark flex h-8 w-8 items-center justify-center border border-[#FAF9F6]/70 bg-[#121215] text-[#FAF9F6] transition-colors hover:bg-[#FAF9F6] hover:text-[#0B0B0D]"
                >
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 10 10"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M2 2L8 8M8 2L2 8"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* Enlarged Image Frame */}
            <div className="sketch-card-dark relative flex max-h-[78dvh] w-full items-center justify-center overflow-hidden border border-[#FAF9F6]/30 bg-[#FAF9F6] p-2 sm:p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selectedItem.url}
                alt={`放大檢視信紙 #${selectedIndex + 1}`}
                className="max-h-[73dvh] w-auto max-w-full object-contain"
              />
            </div>

            {/* Prev / Next Lightbox Controls */}
            {items.length > 1 && (
              <div className="mt-3.5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIndex((prev) =>
                      prev !== null && prev > 0 ? prev - 1 : prev
                    )
                  }
                  disabled={selectedIndex <= 0}
                  className="sketch-pill-dark inline-flex h-8 items-center gap-1 border border-[#FAF9F6]/65 px-3.5 text-xs tracking-[0.14em] text-[#FAF9F6] transition-colors hover:bg-[#FAF9F6]/12 disabled:opacity-30"
                >
                  <span>上一張</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIndex((prev) =>
                      prev !== null && prev < items.length - 1 ? prev + 1 : prev
                    )
                  }
                  disabled={selectedIndex >= items.length - 1}
                  className="sketch-pill-dark inline-flex h-8 items-center gap-1 border border-[#FAF9F6]/65 px-3.5 text-xs tracking-[0.14em] text-[#FAF9F6] transition-colors hover:bg-[#FAF9F6]/12 disabled:opacity-30"
                >
                  <span>下一張</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
