import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type Theme } from "@/components/theme-provider";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const satisfies ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof Sun;
}>;

export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const current = themeOptions.find((option) => option.value === theme) ?? themeOptions[2];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Theme: ${current.label}`}
            title={`Theme: ${current.label}`}
          />
        }
      >
        <CurrentIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-36">
        {themeOptions.map((option) => {
          const Icon = option.icon;
          const selected = option.value === theme;

          return (
            <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)}>
              <Icon />
              <span>{option.label}</span>
              {selected && <Check className="ml-auto size-3.5" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
