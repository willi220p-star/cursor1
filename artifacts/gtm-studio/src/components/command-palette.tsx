import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { FileText, Moon, Search, Settings2, Sun } from 'lucide-react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { relativeTime } from '@/studio/activity';
import { listCampaigns, listStoredFiles, listTemplateConfigs, type StoredFile } from '@/studio/cloud';
import { openCampaignInStudio, openTemplateInStudio, studioInfo, studioInitial, studios } from '@/studio/studios';
import type { SavedCampaign, SavedTemplate } from '@/studio/types';
import { useTheme } from '@/lib/theme';

type Loaded = { campaigns: SavedCampaign[]; templates: SavedTemplate[]; files: StoredFile[] };

export function CommandPalette({ open, onOpenChange, userId }: { open: boolean; onOpenChange: (open: boolean) => void; userId?: string }) {
  const [, navigate] = useLocation();
  const { resolved, setPreference } = useTheme();
  const [data, setData] = useState<Loaded | null>(null);
  const scope = userId ?? 'anonymous';

  useEffect(() => {
    if (!open) return;
    let alive = true;
    Promise.all([
      listCampaigns(userId).catch(() => []),
      listTemplateConfigs(userId).catch(() => []),
      listStoredFiles(userId).catch(() => []),
    ]).then(([campaigns, templates, files]) => {
      if (alive) setData({ campaigns, templates, files });
    });
    return () => { alive = false; };
  }, [open, userId]);

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const openFile = (file: StoredFile) => {
    if (!file.publicUrl) {
      toast.error(`${file.filename} has no Supabase link.`);
      return;
    }
    const opened = window.open(file.publicUrl, '_blank', 'noopener,noreferrer');
    if (!opened) toast.error('Allow pop-ups to open that file.');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="cmdk-dialog [&>button]:hidden">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Jump to a studio, campaign, saved look or file.</DialogDescription>
        <Command label="Search the studio" loop>
          <div className="cmdk-input-row">
            <Search size={18} className="text-muted-foreground" aria-hidden />
            <Command.Input placeholder="Search campaigns, looks, files and studios" autoFocus />
          </div>
          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">Nothing matches that. Try a prospect, a company or a studio name.</Command.Empty>
            <Command.Group heading="Studios">
              {studios.map((studio) => (
                <Command.Item key={studio.key} value={`studio ${studio.label} ${studio.title}`} className="cmdk-item" onSelect={() => run(() => navigate(studio.href))}>
                  <span className="item-mark" data-studio={studio.key} aria-hidden>{studioInitial(studio.key)}</span>
                  <span className="item-text"><strong>{studio.label}</strong><small>{studio.description}</small></span>
                </Command.Item>
              ))}
            </Command.Group>
            {data && data.campaigns.length > 0 && (
              <Command.Group heading="Campaigns">
                {data.campaigns.map((campaign) => (
                  <Command.Item key={campaign.id} value={`campaign ${campaign.name} ${studioInfo(campaign.mode).label} ${campaign.id}`} className="cmdk-item" onSelect={() => run(() => openCampaignInStudio(scope, campaign, navigate))}>
                    <span className="item-mark" data-studio={campaign.mode} aria-hidden>{studioInitial(campaign.mode)}</span>
                    <span className="item-text"><strong>{campaign.name}</strong><small>{studioInfo(campaign.mode).label} campaign, edited {relativeTime(campaign.updatedAt)}</small></span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {data && data.templates.length > 0 && (
              <Command.Group heading="Saved looks">
                {data.templates.map((template) => (
                  <Command.Item key={template.id} value={`look template ${template.name} ${studioInfo(template.mode).label} ${template.id}`} className="cmdk-item" onSelect={() => run(() => openTemplateInStudio(scope, template, navigate))}>
                    <span className="item-mark" data-studio={template.mode} aria-hidden>{studioInitial(template.mode)}</span>
                    <span className="item-text"><strong>{template.name}</strong><small>{studioInfo(template.mode).label} look</small></span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {data && data.files.length > 0 && (
              <Command.Group heading="Files">
                {data.files.map((file) => (
                  <Command.Item key={file.id} value={`file ${file.filename} ${file.label} ${file.id}`} className="cmdk-item" onSelect={() => run(() => openFile(file))}>
                    <span className="item-mark" data-studio="file" aria-hidden><FileText size={16} /></span>
                    <span className="item-text"><strong>{file.filename}</strong><small>{file.label}</small></span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Actions">
              <Command.Item value="action settings" className="cmdk-item" onSelect={() => run(() => navigate('/settings'))}>
                <span className="item-mark" data-studio="file" aria-hidden><Settings2 size={16} /></span>
                <span className="item-text"><strong>Settings</strong><small>Access, storage and theme</small></span>
              </Command.Item>
              <Command.Item value="action theme dark light mode" className="cmdk-item" onSelect={() => run(() => setPreference(resolved === 'dark' ? 'light' : 'dark'))}>
                <span className="item-mark" data-studio="file" aria-hidden>{resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</span>
                <span className="item-text"><strong>{resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</strong><small>Applies on this device</small></span>
              </Command.Item>
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
