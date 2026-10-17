import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'wouter';
import { errorMessage } from '@/lib/app-error';
import { CampaignSignoff } from '@/components/studio/campaign-signoff';
import { CommentThread } from '@/components/studio/comment-thread';
import { ReviewControls } from '@/components/studio/review-controls';
import { latestAssetPerContact, listCampaignAssets, loadCampaignInfo, type AssetRef, type CampaignInfo } from '@/studio/reviews';

/**
 * One campaign's generated images with approve / request changes, comments and sign-off.
 * The only review screen Client Viewers get, since they cannot open the studios.
 */
export function ReviewPage({ campaignId }: { campaignId: string }) {
  const [info, setInfo] = useState<CampaignInfo | null | undefined>(undefined);
  const [assets, setAssets] = useState<AssetRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([loadCampaignInfo(campaignId), listCampaignAssets([campaignId])])
      .then(([campaign, rows]) => {
        if (!live) return;
        setInfo(campaign);
        setAssets(latestAssetPerContact(rows));
      })
      .catch((caught) => live && setError(errorMessage(caught)));
    return () => {
      live = false;
    };
  }, [campaignId]);

  return (
    <main className="mx-auto w-full min-w-0 max-w-6xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 md:px-8 md:py-8">
      <Link href="/" className="btn btn-ghost mb-4 inline-flex items-center gap-1">
        <ChevronLeft size={16} aria-hidden /> Desk
      </Link>
      {error && <p role="alert" className="panel p-4 text-destructive">{error}</p>}
      {info === null && !error && <p className="panel p-4">This campaign no longer exists or you don't have access to it.</p>}
      {info && (
        <>
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h1 className="min-w-0 break-words text-2xl font-semibold">{info.name}</h1>
            <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <CommentThread campaignId={campaignId} label="Campaign comments" />
              <CampaignSignoff campaignId={campaignId} />
            </div>
          </header>
          {assets === null ? (
            <p className="text-muted-foreground">Loading images…</p>
          ) : assets.length === 0 ? (
            <p className="panel p-4">No images have been generated for this campaign yet.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Images to review">
              {assets.map((asset) => {
                const ref = { id: asset.id, publicUrl: asset.public_url ?? undefined, filename: asset.contact_key ?? asset.id };
                return (
                  <li key={asset.id} className="panel flex min-w-0 flex-col gap-3 p-3" data-review-tile tabIndex={0}>
                    {asset.public_url && <img src={asset.public_url} alt={`Image for ${ref.filename}`} className="w-full rounded-lg" loading="lazy" />}
                    <div className="flex min-w-0 flex-col gap-2">
                      <ReviewControls campaignId={campaignId} asset={ref} />
                      <CommentThread campaignId={campaignId} asset={ref} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
