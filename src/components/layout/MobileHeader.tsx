import React from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { Bell, Eye, EyeOff, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface MobileHeaderProps {
  balanceVisible: boolean;
  onToggleBalance: () => void;
}

export function MobileHeader({ balanceVisible, onToggleBalance }: MobileHeaderProps) {
  const { profile, currentCompany, companies, setCurrentCompany } = useAuth();

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-gradient-bank-header text-white">
      {/* Top row */}
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        {/* Avatar */}
        <Avatar className="h-10 w-10 border-2 border-white/30">
          <AvatarImage src={profile?.avatar_url || undefined} />
          <AvatarFallback className="bg-white/20 text-white text-sm font-bold">
            {getInitials(profile?.full_name || "U")}
          </AvatarFallback>
        </Avatar>

        {/* Center - Logo */}
        <div className="flex flex-col items-center">
          <span className="font-bold text-lg tracking-wider">PIXFLOW</span>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 h-9 w-9"
            onClick={onToggleBalance}
          >
            {balanceVisible ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/10 h-9 w-9"
          >
            <Bell className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Bottom row - Company info */}
      <div className="px-4 pb-3">
        {companies.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 text-white/80 text-xs hover:text-white transition-colors">
                <Building2 className="h-3.5 w-3.5" />
                <span className="truncate max-w-[200px]">{currentCompany?.name || "Selecionar empresa"}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>Empresas</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {companies.map((company) => (
                <DropdownMenuItem
                  key={company.id}
                  onClick={() => setCurrentCompany(company)}
                  className={cn(currentCompany?.id === company.id && "bg-accent")}
                >
                  {company.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-2 text-white/80 text-xs">
            <Building2 className="h-3.5 w-3.5" />
            <span>{currentCompany?.name}</span>
          </div>
        )}
      </div>
    </header>
  );
}
