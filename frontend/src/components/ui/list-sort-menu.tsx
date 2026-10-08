import { Button } from "@/components/ui/button";

export type ListSortMode = "recent" | "oldest" | "az" | "za";

interface ListSortMenuProps {
  value: ListSortMode;
  onValueChange: (value: ListSortMode) => void;
  labels: {
    recent: string;
    oldest: string;
    az: string;
    za: string;
  };
}

export function ListSortMenu({ value, onValueChange, labels }: ListSortMenuProps) {
  const modes: ListSortMode[] = ["recent", "oldest", "az", "za"];
  const currentIndex = modes.indexOf(value);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-12 w-12 shrink-0 rounded-2xl bg-accent lg:h-8 lg:w-8 lg:rounded-md"
      onClick={() => onValueChange(modes[(currentIndex + 1) % modes.length])}
      aria-label={labels[value]}
      title={labels[value]}
    >
      {value === "recent" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
          <path d="M12 4v16m-7-7 7 7 7-7" />
        </svg>
      )}
      {value === "oldest" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
          <path d="M12 20V4m7 7-7-7-7 7" />
        </svg>
      )}
      {(value === "az" || value === "za") && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
          <text x="3" y="10" fill="currentColor" stroke="none" fontSize="8" fontWeight="600">{value === "az" ? "A" : "Z"}</text>
          <text x="3" y="19" fill="currentColor" stroke="none" fontSize="8" fontWeight="600">{value === "az" ? "Z" : "A"}</text>
          {value === "az"
            ? <path d="M18 4v15m-4-4 4 4 4-4" />
            : <path d="M18 20V5m4 4-4-4-4 4" />}
        </svg>
      )}
    </Button>
  );
}
