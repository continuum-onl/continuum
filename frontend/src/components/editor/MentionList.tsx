import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import { Hash, AtSign, Plus, FileText, User, Folder, Building2, Tag, CircleDot, ChevronDown } from "@/lib/heroicons";
import { useLanguage } from "@/contexts/LanguageContext";

export interface MentionItem {
  id: string;
  title: string;
  type: string;
  isCreate?: boolean;
  createKind?: "entity" | "note";
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
  query: string;
  variant: "entity" | "note";
}

export interface MentionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const iconFor = (type: string) => {
  switch (type) {
    case "NOTE":
      return FileText;
    case "PERSON":
      return User;
    case "PROJECT":
      return Folder;
    case "ORGANIZATION":
      return Building2;
    case "ACTIVITY":
      return CircleDot;
    default:
      return Tag;
  }
};

export const MentionList = forwardRef<MentionListRef, MentionListProps>(
  ({ items, command, query, variant }, ref) => {
    const { t } = useLanguage();
    const [selected, setSelected] = useState(0);
    const [entityType, setEntityType] = useState("TOPIC");
    const [showTypeSelector, setShowTypeSelector] = useState(false);
    useEffect(() => setSelected(0), [items]);

    const entityTypes = [
      { value: "PERSON", label: t("ed_type_person"), icon: User },
      { value: "PROJECT", label: t("ed_type_project"), icon: Folder },
      { value: "TOPIC", label: t("ed_type_topic"), icon: Tag },
      { value: "ORGANIZATION", label: t("ed_type_organization"), icon: Building2 },
      { value: "ACTIVITY", label: t("ed_type_activity"), icon: CircleDot },
    ];

    const select = (i: number) => {
      const item = items[i];
      if (item) {
        if (item.isCreate && item.createKind === "entity") {
          // Override the type with selected entity type
          const itemWithType = { ...item, type: entityType };
          command(itemWithType);
        } else {
          command(item);
        }
      }
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          setSelected((s) => (s + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          select(selected);
          return true;
        }
        return false;
      },
    }));

    const Trigger = variant === "note" ? Hash : AtSign;

    return (
      <div
        style={{
          width: "fit-content",
          minWidth: 180,
          maxWidth: "min(360px, calc(100vw - 1rem))",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(18, 19, 22, 0.72)",
          boxShadow: "0 12px 30px rgba(0,0,0,0.34)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          overflow: "hidden",
        }}
        className=""
      >
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/8 bg-black/10">
          <Trigger className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-[10px] text-muted-foreground truncate font-medium">
            {query ? t("ed_searching_query", { query }) : variant === "note" ? t("ed_link_a_note") : t("ed_mention_an_entity")}
          </span>
        </div>

        {variant === "entity" && items.some(item => item.isCreate && item.createKind === "entity") && (
          <div className="px-2.5 py-1.5 border-b border-white/8 bg-black/8">
            <div className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70 mb-1.5">{t("ed_entity_type_label")}</div>
            <div className="relative">
              <button
                onClick={() => setShowTypeSelector(!showTypeSelector)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border border-white/8 bg-white/[0.03] text-foreground transition-colors hover:bg-white/[0.05]"
              >
                {(() => {
                  const selectedType = entityTypes.find(t => t.value === entityType);
                  const Icon = selectedType?.icon || Tag;
                  return (
                    <>
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="flex-1 text-left">{selectedType?.label}</span>
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    </>
                  );
                })()}
              </button>
              {showTypeSelector && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1b1d20]/85 border border-white/8 rounded-md shadow-[0_12px_30px_rgba(0,0,0,0.3)] z-50 max-h-36 overflow-y-auto backdrop-blur-[10px]">
                  {entityTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.value}
                        onClick={() => {
                          setEntityType(type.value);
                          setShowTypeSelector(false);
                        }}
                        className="flex items-center gap-2 w-full px-2.5 py-1.5 text-[12px] text-foreground hover:bg-white/[0.04] transition-colors"
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{type.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="max-h-44 overflow-y-auto py-1">
          {items.length === 0 ? (
            <div className="px-2.5 py-3 text-[11px] text-muted-foreground text-center">{t("ed_no_results")}</div>
          ) : (
            items.map((item, i) => {
              const Icon = item.isCreate ? Plus : iconFor(item.type);
              const isSelected = i === selected;
              return (
                <button
                  key={`${item.id}-${i}`}
                  onMouseDown={(e) => { e.preventDefault(); select(i); }}
                  className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-left transition-colors ${
                    isSelected
                      ? "bg-white/[0.06] text-foreground"
                      : "text-popover-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  <span className={`flex items-center justify-center w-6 h-6 rounded-md ${
                    item.isCreate ? "bg-primary/10 text-primary" : "bg-white/[0.04] text-muted-foreground"
                  }`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[12px] font-medium leading-tight">{item.title}</div>
                    {item.isCreate && (
                      <div className="text-[9px] text-muted-foreground mt-0.5">
                        {t("ed_create_new", { kind: item.createKind === "entity" ? t("ed_kind_entity") : t("ed_kind_note") })}
                      </div>
                    )}
                    {!item.isCreate && (
                      <div className="text-[9px] text-muted-foreground capitalize mt-0.5">
                        {item.type.toLowerCase()}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="px-2.5 py-1 border-t border-white/8 bg-black/10 text-[8px] text-muted-foreground flex items-center gap-2.5">
          <span><kbd className="px-1 py-0.5 rounded bg-white/[0.04] border border-white/8">↑↓</kbd> {t("ed_nav_hint")}</span>
          <span><kbd className="px-1 py-0.5 rounded bg-white/[0.04] border border-white/8">↵</kbd> {t("ed_select_hint")}</span>
          <span><kbd className="px-1 py-0.5 rounded bg-white/[0.04] border border-white/8">esc</kbd> {t("ed_close_hint")}</span>
        </div>
      </div>
    );
  }
);
MentionList.displayName = "MentionList";
