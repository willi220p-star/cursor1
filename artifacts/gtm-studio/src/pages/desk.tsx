import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CircleUser, Film, Image, Pencil } from 'lucide-react';
import { Library } from '@/components/studio/library';
import { GuideButton } from '@/components/studio/guide-sheet';
import { PanelBoundary } from '@/components/error-boundary';
import { publicAssetUrl } from '@/lib/public-url';
import { exportsInLast30Days, LIBRARY_CHANGED_EVENT, requestSampleList } from '@/studio/activity';
import { campaignClient, campaignStatus, formatHistoryEntry, recentHistory, statusLabels } from '@/studio/campaign-status';
import { listCampaigns, subscribeTemplateChanges } from '@/studio/cloud';
import { reportError } from '@/lib/report';
import { renderMerge } from '@/studio/merge';
import { openCampaignInStudio, openTemplateInStudio, studioInfo, type StudioKey } from '@/studio/studios';
import type { SavedCampaign, SavedTemplate } from '@/studio/types';

const SAMPLE_NOTE = 'Hi there,\n\nEvery note in here is written for one person. That is why they get read.\n\nDGK';

function noteFor(campaign: SavedCampaign | null) {
  if (!campaign) return SAMPLE_NOTE;
  const contact = campaign.contacts?.[0];
  const copy = campaign.config.copy || campaign.config.message || '';
  if (!contact || !copy.trim()) return campaign.name;
  const text = renderMerge(copy, contact).trim();
  return text.length > 280 ? `${text.slice(0, 277)}…` : text;
}

function TileIcon({ studio }: { studio: StudioKey }) {
  if (studio === 'handgif') return <Pencil size={26} strokeWidth={1.75} aria-hidden />;
  if (studio === 'avatar') return <CircleUser size={26} strokeWidth={1.75} aria-hidden />;
  if (studio === 'memes') return <Image size={26} strokeWidth={1.75} aria-hidden />;
  return <Film size={26} strokeWidth={1.75} aria-hidden />;
}

function StudioTile({ studio, className = '' }: { studio: StudioKey; className?: string }) {
  const info = studioInfo(studio);
  return (
    <Link href={info.href} data-studio={studio} className={`studio-tile ${className}`}>
      <TileIcon studio={studio} />
      <span>
        <span className="tile-name">{info.label}</span>
        <span className="tile-copy">{info.description}</span>
      </span>
    </Link>
  );
}

export function DeskPage({ userId, email }: { userId?: string; email?: string }) {
  const [, navigate] = useLocation();
  const scope = userId ?? 'anonymous';
  const [campaigns, setCampaigns] = useState<SavedCampaign[] | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [campaignsFailed, setCampaignsFailed] = useState(false);
  const refreshStats = () => {
    setCampaignsFailed(false);
    listCampaigns(userId).then(setCampaigns).catch((error) => {
      reportError(error, { area: 'desk' });
      setCampaignsFailed(true);
      setCampaigns([]);
    });
  };
  const refreshDesk = () => {
    refreshStats();
    setLibraryRevision((value) => value + 1);
  };
  useEffect(() => {
    refreshStats();
    // Search (Ctrl+K) can duplicate a campaign from any page; refresh when it does.
    window.addEventListener(LIBRARY_CHANGED_EVENT, refreshDesk);
    const unsubscribe = subscribeTemplateChanges(userId, refreshDesk);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED_EVENT, refreshDesk);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const openCampaign = (campaign: SavedCampaign) => openCampaignInStudio(scope, campaign, navigate);
  const openTemplate = (template: SavedTemplate) => openTemplateInStudio(scope, template, navigate);
  const loadSample = () => {
    requestSampleList(scope);
    navigate('/handwritten');
  };

  const list = campaigns ?? [];
  const latest = useMemo(
    () => list.reduce<SavedCampaign | null>((best, campaign) => (!best || campaign.updatedAt > best.updatedAt ? campaign : best), null),
    [list],
  );
  const contactCount = list.reduce((sum, campaign) => sum + (campaign.contacts?.length ?? 0), 0);
  const exported = exportsInLast30Days(scope);
  const firstName = (email?.split('@')[0]?.split('.')[0] ?? 'operator').replace(/^\w/, (c) => c.toUpperCase());
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const latestStudio = latest ? studioInfo(latest.mode) : null;
  const latestStatus = latest ? campaignStatus(latest.config) : null;
  const latestEvent = latest ? recentHistory(latest.config, 1)[0] : undefined;
  const latestClient = latest ? campaignClient(latest) : '';
  const sceneLabel = latest
    ? `Open ${latest.name} in ${latestStudio?.label}`
    : 'Load the sample list in Notes';

  return (
    <div className="desk animate-rise">
      <section className="desk-hero" aria-labelledby="desk-heading">
        <div className="desk-hero-copy">
          <h1 id="desk-heading" className="display">{greeting}, {firstName}.</h1>
          <p className="desk-hero-lead">
            {campaigns === null
              ? 'Getting your desk ready.'
              : latest
                ? `${latest.name} is where you left it. Pick up there, or start something new.`
                : 'Pick a studio, or load the sample list to see how a campaign comes together.'}
          </p>
          <div className="desk-hero-actions">
            {latest ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => openCampaign(latest)}>Continue {latest.name}</button>
                <Link href="/handwritten" className="btn btn-outline">New Notes campaign</Link>
              </>
            ) : (
              <>
                <Link href="/handwritten" className="btn btn-primary">Start with Notes</Link>
                <button type="button" className="btn btn-outline" onClick={loadSample}>Load the sample list</button>
              </>
            )}
            <GuideButton guideKey="desk" withLabel />
          </div>
          {latest && latestStatus && (
            <p className="desk-continue-meta" data-testid="continue-status">
              <span className="status-pill" data-status={latestStatus}>{statusLabels[latestStatus]}</span>
              <span>{latestEvent ? formatHistoryEntry(latestEvent) : 'Nothing generated yet'}</span>
              {latestClient && <span>· {latestClient}</span>}
            </p>
          )}
          {campaignsFailed && (
            <div className="load-error" role="alert">
              <span>Could not load your campaigns, so these numbers may be wrong.</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={refreshStats}>Retry</button>
            </div>
          )}
          <p className="desk-stats" aria-label="Workspace numbers">
            <span><strong>{list.length}</strong> {list.length === 1 ? 'campaign' : 'campaigns'}</span>
            <span><strong>{contactCount}</strong> prospect rows</span>
            <span><strong>{exported}</strong> exported in the last 30 days</span>
          </p>
        </div>
        <button
          type="button"
          className="desk-scene"
          aria-label={sceneLabel}
          style={{ backgroundImage: `url(${publicAssetUrl('/desk/walnut.png')})` }}
          onClick={() => (latest ? openCampaign(latest) : loadSample())}
        >
          <span className="desk-paper" aria-hidden>{noteFor(latest)}</span>
          <span className="desk-scene-tag">{latest ? `${latestStudio?.label}, ${latest.contacts?.length ?? 0} rows` : 'Sample note'}</span>
        </button>
      </section>

      <section aria-labelledby="studios-heading" className="flex flex-col gap-5">
        <h2 id="studios-heading" className="section-title">Studios</h2>
        <div className="studio-bento">
          <Link href="/handwritten" data-studio="handwritten" className="studio-tile is-feature">
            <span className="tile-text">
              <span className="tile-kicker">Used most</span>
              <span>
                <span className="tile-name">Notes</span>
                <span className="tile-copy">{studioInfo('handwritten').description}</span>
              </span>
            </span>
            <span className="tile-paper" style={{ backgroundImage: `url(${publicAssetUrl('/paper/linen.png')})` }} aria-hidden>
              Hi Priya, loved your post about the new intake process…
            </span>
          </Link>
          <StudioTile studio="handgif" />
          <StudioTile studio="avatar" />
          <StudioTile studio="memes" />
          <StudioTile studio="gif" />
          <Link href="/carousel" data-studio="carousel" className="studio-tile is-wide">
            <span>
              <span className="tile-name">Carousel</span>
              <span className="tile-copy">{studioInfo('carousel').description}</span>
            </span>
            <span className="tile-pages" aria-hidden><span /><span /><span /></span>
          </Link>
        </div>
      </section>

      <PanelBoundary label="The library">
      <Library
        userId={userId}
        revision={libraryRevision}
        onChanged={refreshDesk}
        onOpenCampaign={openCampaign}
        onOpenTemplate={openTemplate}
        onLoadSample={loadSample}
      />
      </PanelBoundary>
    </div>
  );
}
