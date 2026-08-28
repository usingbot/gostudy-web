import { Coffee, BookOpen, Moon, Star, ShieldCheck, HelpCircle } from 'lucide-react';

export const renderIcon = (name: string, className?: string) => {
  const map: Record<string, any> = {
    Coffee,
    BookOpen,
    Moon,
    Star,
    ShieldCheck
  };
  
  const Icon = map[name] || HelpCircle;
  return <Icon className={className} />;
};
