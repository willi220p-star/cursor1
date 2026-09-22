import {
  ArrowRight,
  CircleAlert,
  Copy,
  Crop,
  Download,
  FileArchive,
  FolderOpen,
  ImagePlus,
  Images,
  Keyboard,
  Link2,
  LoaderCircle,
  Palette,
  Pause,
  PenLine,
  PenTool,
  Play,
  Plus,
  Save,
  Send,
  Shuffle,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Wand2,
  X,
} from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useMediaQuery } from '@/hooks/use-media-query';
import { defaultConfig, defaultLayers, normalizeConfig, templateOptions } from '@/studio/defaults';
import { contactColumns, prepareImportedContacts } from '@/studio/importers';
import { consumeSampleListRequest, loadSampleList, recordExport } from '@/studio/activity';
import { decodeGifFile } from '@/studio/gif-decoder';
import { createBatchRenderer } from '@/studio/batch-renderer';
import { loadArtefactFonts } from '@/studio/fonts';
import { unresolvedTags, safeFilename, renderMerge } from '@/studio/merge';
import {
  canvasToBlob,
  deskTextureUrls,
  dimensions,
  isLiveGif,
  modeLabel,
  renderGifAsset,
  renderPreview,
  renderStaticAsset,
  resolveAvatarSource,
  resolveMessage,
  probeImage,
  usesLivePreview,
  usesMotion,
  usesPhotoMotion,
  usesTextAnim,
} from '@/studio/renderer';
import {
  copyTemplateConfig,
  ensureAssetBlob,
  listStudioAssets,
  listTemplateConfigs,
  peekLocalCampaign,
  persistImportedList,
  persistStudioImage,
  removeStoredImage,
  saveCampaign,
  saveTemplateConfig,
  subscribeTemplateChanges,
  supabaseConfigured,
  uploadGeneratedAssets,
} from '@/studio/cloud';
import {
  contactsStorageKey,
  hydratePortraits,
  persistContactList,
  persistContactsForModes,
  readStoredContacts,
  snapshotPortrait,
} from '@/studio/portraits';
import {
  AVATAR_CACHE_FIELD,
  AVATAR_SOURCE_FIELD,
  avatarInNoteLayout,
  canvasSizes,
  clampZoneInside,
  cropLayerStyle,
  defaultCrop,
  deskSurfaces,
  finishPaperZone,
  guessAvatarColumn,
  guessColumn,
  handwritingKinds,
  noteWritingStyles,
  memeMotions,
  messageColumnAliases,
  modeHref,
  noteFinishes,
  paperColorPresets,
  paperKinds,
  paperTextures,
  writingHands,
  writingSpeeds,
  writingSpeedSpec,
  shiftZone,
  studioLabel,
  textAnims,
  textMotions,
  typedFonts,
  type AvatarShape,
  type CanvasSize,
  type Contact,
  type CropFocus,
  type GeneratedAsset,
  type PaperColorPreset,
  type PaperKind,
  type SavedCampaign,
  type SavedTemplate,
  type StudioConfig,
  type StudioMode,
  type TextAnim,
  type TextLayer,
  type TextMotion,
  type WritingHandId,
  type WritingSpeed,
} from '@/studio/types';
import {
  exportListCsv,
  listExportColumns,
  outputColumnNames,
  persistListMeta,
  readListMeta,
  stampStudioOutputs,
  withOutputFieldMap,
} from '@/studio/writeback';
import { memeSamples, type MemeSample } from '@/studio/meme-samples';
import { publicAssetUrl } from '@/lib/utils';
import { BatchReview } from '@/components/studio/batch-review';
import { ContactFilmstrip } from '@/components/studio/contact-filmstrip';
import { ImportDialog, type ImportResult, type ImportStep } from '@/components/studio/import-dialog';
import type { FieldAssignment } from '@/studio/field-map';
import { SampleStrip } from '@/components/studio/sample-strip';
import { SignaturePad } from '@/components/studio/signature-pad';
import { ShortcutsDialog } from '@/components/studio/shortcuts-dialog';
import { ColorField, DurablePortrait, FieldRow, FileButton, InfoTip, Section, SliderField, contactMeta, contactName } from '@/components/studio/shared';

function StyledLayerText({ text, highlight, color }: { text: string; highlight?: string; color?: string }) {
  const tokens = (highlight || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!tokens.length) return <>{text}</>;
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((part, index) => (
        tokens.some((token) => token.toLowerCase() === part.toLowerCase())
          ? <mark key={`${part}-${index}`} style={{ background: color || '#ffe566', color: 'inherit', padding: '0 .12em', borderRadius: 2 }}>{part}</mark>
          : <span key={`${part}-${index}`}>{part}</span>
      ))}
    </>
  );
}

const sampleContacts: Contact[] = [
  { row: 2, first_name: 'Maya', company: 'Top End Solar', role: 'Director', city: 'Darwin', website: '', avatar: '/avatars/maya.svg', msg: 'Loved the Darwin launch — more of this, please.' },
  { row: 3, first_name: 'Ethan', company: 'Saltbush Studio', role: 'Founder', city: 'Palmerston', website: '', avatar: '/avatars/ethan.svg', msg: 'Your team’s work in Palmerston stood out this week.' },
  { row: 4, first_name: 'Priya', company: 'Larrakia Legal', role: 'Principal', city: 'Darwin', website: '', avatar: '/avatars/priya.svg', msg: 'One idea for qualified conversations in NT law.' },
  { row: 5, first_name: 'Noah', company: 'Red Centre Logistics', role: 'GM', city: 'Katherine', website: '', avatar: '/avatars/noah.svg', msg: 'Worth a 12-minute chat next week?' },
];

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the uploaded file.'));
    reader.readAsDataURL(file);
  });
}

/** Turn a raw failure into what happened / why / how to fix. */
function explainError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('cloud sync failed')) return `${message} The work is safe in this browser — check your connection or Supabase policies, then press Save again.`;
  if (lower.includes('10 mb') || lower.includes('15 mb')) return `${message} Export a smaller version from your editor and try again.`;
  if (lower.includes('could not be loaded') || lower.includes('blocks links')) return `${message} Save the photo to this computer and use Add photo instead.`;
  if (lower.includes('font could not be loaded')) return `${message} Google Fonts exports and most foundry files work as TTF, OTF, WOFF or WOFF2.`;
  if (lower.includes('select at least one')) return `${message} Tick the rows you want in the batch review, then download again.`;
  if (lower.includes('animated export is skipped')) return message;
  return message;
}

function CropSliders({
  label,
  crop,
  onChange,
}: {
  label: string;
  crop: CropFocus;
  onChange: (crop: CropFocus) => void;
}) {
  const id = label.replace(/\W+/g, '-').toLowerCase();
  return (
    <Section title={label} hint="Turn on Crop above the stage, then drag to pan and scroll to zoom. These sliders do the same.">
      <div className="grid grid-cols-3 gap-3">
        <SliderField id={`${id}-zoom`} label="Zoom" display={`${crop.zoom.toFixed(2)}×`} min={1} max={4} step={0.05} value={crop.zoom} onChange={(zoom) => onChange({ ...crop, zoom })} />
        <SliderField id={`${id}-x`} label="Left / right" display={`${Math.round(crop.x * 100)}%`} min={0} max={100} value={Math.round(crop.x * 100)} onChange={(x) => onChange({ ...crop, x: x / 100 })} />
        <SliderField id={`${id}-y`} label="Up / down" display={`${Math.round(crop.y * 100)}%`} min={0} max={100} value={Math.round(crop.y * 100)} onChange={(y) => onChange({ ...crop, y: y / 100 })} />
      </div>
    </Section>
  );
}

function readPendingCampaign(mode: StudioMode, userId?: string) {
  const scope = userId ?? 'anonymous';
  try {
    const pending = JSON.parse(localStorage.getItem(`gtm-studio-load-campaign:${scope}`) || '') as SavedCampaign;
    return pending.mode === mode ? { ...pending, config: normalizeConfig(mode, pending.config) } : null;
  } catch {
    return null;
  }
}

function readPendingTemplate(mode: StudioMode, userId?: string) {
  const scope = userId ?? 'anonymous';
  try {
    const pending = JSON.parse(localStorage.getItem(`gtm-studio-load-template:${scope}`) || '') as SavedTemplate;
    if (pending.mode !== mode) return null;
    localStorage.removeItem(`gtm-studio-load-template:${scope}`);
    return normalizeConfig(mode, { ...pending.config, templateId: pending.id, campaignName: pending.name });
  } catch {
    return null;
  }
}

function exportIsAnimated(mode: StudioMode, config: StudioConfig) {
  if (mode === 'gif' || mode === 'handgif') return true;
  if (mode === 'avatar') return (config.textMotion ?? 'still') !== 'still';
  if ((config.layers ?? []).some((layer) => (layer.animation ?? 'still') !== 'still')) return true;
  return mode === 'memes' && (usesMotion(config) || usesPhotoMotion(config) || isLiveGif(config));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

type DeskTab = 'copy' | 'look' | 'ship';
type ZoneKind = 'text' | 'website' | 'avatar' | 'note';

export function StudioGenerator({
  mode,
  userId,
}: {
  mode: StudioMode;
  userId?: string;
}) {
  const scope = userId ?? 'anonymous';
  const [, navigate] = useLocation();
  const pendingCampaign = useRef<SavedCampaign | null>(readPendingCampaign(mode, userId));
  const [contacts, setContacts] = useState<Contact[]>(() => {
    if (pendingCampaign.current?.contacts?.length) return pendingCampaign.current.contacts;
    return readStoredContacts(scope, mode) ?? sampleContacts;
  });
  const [config, setConfig] = useState<StudioConfig>(() => {
    if (pendingCampaign.current) {
      localStorage.removeItem(`gtm-studio-load-campaign:${scope}`);
      return pendingCampaign.current.config;
    }
    const pendingTemplate = readPendingTemplate(mode, userId);
    if (pendingTemplate) return pendingTemplate;
    const meta = readListMeta(scope, mode);
    const base = defaultConfig(mode);
    if (!meta) return base;
    return {
      ...base,
      fieldMap: meta.fieldMap ?? base.fieldMap,
      listSource: meta.listSource ?? base.listSource,
      sourceColumns: meta.sourceColumns ?? base.sourceColumns,
      avatarColumn: mode === 'avatar' ? (meta.avatarColumn || base.avatarColumn) : base.avatarColumn,
      messageColumn: meta.messageColumn || base.messageColumn,
    };
  });
  const [selectedRow, setSelectedRow] = useState(0);
  const [activeLayerId, setActiveLayerId] = useState('headline');
  const [activeCanvasZone, setActiveCanvasZone] = useState<ZoneKind>('note');
  const [cropMode, setCropMode] = useState<'off' | 'image' | 'avatar'>('off');
  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [slowPreview, setSlowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [libraryMemes, setLibraryMemes] = useState<MemeSample[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [listStep, setListStep] = useState<ImportStep>('source');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [stagePaused, setStagePaused] = useState(false);
  const [deskTab, setDeskTab] = useState<DeskTab>('copy');
  const [announcement, setAnnouncement] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const cancelRef = useRef(false);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const assetsRef = useRef<GeneratedAsset[]>([]);
  const batchControllerRef = useRef<AbortController | null>(null);
  const staticWorkerRef = useRef<ReturnType<typeof createBatchRenderer> | null>(null);
  const batchStartRef = useRef(0);
  const dragRef = useRef<{ kind: ZoneKind | 'crop-image' | 'crop-avatar'; resize: boolean; startX: number; startY: number; zone: { x: number; y: number; width: number; height: number }; companions?: { avatar: { x: number; y: number; width: number; height: number }; text: { x: number; y: number; width: number; height: number } } } | null>(null);
  const hydrateGen = useRef(0);
  const contactsKey = contactsStorageKey(scope, mode);
  const columns = useMemo(() => contactColumns(contacts), [contacts]);
  const gallerySamples = useMemo(() => [...libraryMemes, ...memeSamples], [libraryMemes]);
  const contact = contacts[selectedRow] ?? sampleContacts[0];
  const activeLayer = config.layers.find((layer) => layer.id === activeLayerId) ?? config.layers[0];
  const invalid = unresolvedTags(
    mode === 'memes' || mode === 'gif'
      ? config.layers.map((layer) => layer.text).join(' ')
      : `${config.copy}\n${config.message}`,
    contact,
  );
  const avatarSource = resolveAvatarSource(config, contact);
  const previewMessage = resolveMessage(config, contact);
  const animatedExport = exportIsAnimated(mode, config);
  const previewFilename = safeFilename(config.filename, contact, animatedExport ? 'gif' : 'png');

  useEffect(() => {
    void loadArtefactFonts();
  }, []);

  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!canvas) return;
    let cancelled = false;
    const previewAbort = new AbortController();
    const moving = usesLivePreview(config);
    const phaseLoop = usesTextAnim(config) && (mode === 'handgif' || mode === 'avatar' || mode === 'memes' || mode === 'gif');
    setPreviewing(true);
    const draw = (phase: number) => renderPreview(config, contact, canvas, phase, {
      omitText: moving && (mode === 'memes' || mode === 'gif'),
      omitImage: isLiveGif(config) || usesPhotoMotion(config),
      omitAvatar: mode === 'avatar' && Boolean(avatarSource),
      signal: previewAbort.signal,
    });
    if (phaseLoop && (mode === 'handgif' || mode === 'avatar') && !generating && !downloading && !stagePaused) {
      let raf = 0;
      let last = 0;
      const start = performance.now();
      const tick = (now: number) => {
        if (cancelled) return;
        if (now - last > 140) {
          last = now;
          const duration = mode === 'handgif' ? writingSpeedSpec(config.writingSpeed).ms : 3600;
          const raw = ((now - start) / duration) % 1;
          const elapsed = mode === 'avatar' ? (raw < 0.72 ? raw / 0.72 : 1) : raw;
          void draw(stagePaused ? 1 : elapsed).finally(() => {
            if (!cancelled) setPreviewing(false);
          });
        }
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        previewAbort.abort();
        window.cancelAnimationFrame(raf);
      };
    }
    draw(1)
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Preview failed.');
      })
      .finally(() => {
        if (!cancelled) setPreviewing(false);
      });
    return () => {
      cancelled = true;
      previewAbort.abort();
    };
  }, [config, contact, avatarSource, mode, stagePaused, generating, downloading]);

  // Skeleton only when a preview takes longer than the "instant" threshold.
  useEffect(() => {
    if (!previewing) {
      setSlowPreview(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowPreview(true), 400);
    return () => window.clearTimeout(timer);
  }, [previewing]);

  useEffect(() => {
    const node = previewCanvas.current?.parentElement;
    if (!node || cropMode === 'off') return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const key = cropMode === 'avatar' ? 'avatarCrop' : 'imageCrop';
      const delta = event.deltaY < 0 ? 0.1 : -0.1;
      setConfig((current) => {
        const crop = current[key] ?? defaultCrop;
        return { ...current, [key]: { ...crop, zoom: Math.max(1, Math.min(4, crop.zoom + delta)) } };
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [cropMode]);

  const templateStamp = useRef<Record<string, string>>({});
  const refreshTemplates = () => {
    listTemplateConfigs(userId)
      .then((next) => {
        setSavedTemplates(next);
        setConfig((current) => {
          if (!current.templateId) return current;
          const match = next.find((item) => item.id === current.templateId && item.mode === mode);
          if (!match) return current;
          const previous = templateStamp.current[match.id];
          templateStamp.current[match.id] = match.updatedAt;
          if (!previous || previous === match.updatedAt) return current;
          toast('Template updated from Supabase', { description: match.name });
          return normalizeConfig(mode, { ...match.config, templateId: match.id, campaignName: match.name, mode });
        });
      })
      .catch(() => setSavedTemplates([]));
  };

  useEffect(() => {
    refreshTemplates();
    return subscribeTemplateChanges(userId, refreshTemplates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, mode]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);
  useEffect(() => () => {
    batchControllerRef.current?.abort();
    staticWorkerRef.current?.terminate();
    assetsRef.current.forEach((asset) => asset.url && asset.url.startsWith('blob:') && URL.revokeObjectURL(asset.url));
  }, []);

  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let cancelled = false;
    void listStudioAssets(userId, mode, config.id, config.campaignName)
      .then((stored) => {
        if (cancelled || !stored.length) return;
        setAssets((current) => current.length ? current : stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId, mode, config.id, config.campaignName]);

  useEffect(() => {
    if (!contacts.length) return;
    const row = contacts[Math.min(selectedRow, contacts.length - 1)];
    setAnnouncement(`Row ${Math.min(selectedRow, contacts.length - 1) + 1} of ${contacts.length}, ${contactName(row)}, ${contactMeta(row)}`);
  }, [selectedRow, contacts]);

  const applyMemeSample = (sample: MemeSample) => {
    setConfig((current) => ({
      ...current,
      template: sample.live ? 'Custom GIF or image' : 'Custom image',
      customImage: sample.src,
      animation: sample.animation,
      photoMotion: sample.photoMotion ?? 'still',
      effect: sample.effect ?? 'none',
      gifSourceDataUrl: sample.live ? sample.src : undefined,
      gifFrames: sample.live ? current.gifFrames : undefined,
      gifDelays: sample.live ? current.gifDelays : undefined,
      campaignName: `${sample.name} campaign`,
      layers: sample.layers.map((layer) => ({ ...layer })),
    }));
    setActiveLayerId(sample.layers[0]?.id ?? 'headline');
    toast(`${sample.name} loaded`, { description: 'Edit the text — the image stays.' });
  };

  const importLiveMeme = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Live memes must be 10 MB or smaller.');
      const isGif = file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif');
      let frames: string[] | undefined;
      let delays: number[] | undefined;
      if (isGif) {
        const decoded = await decodeGifFile(file);
        frames = decoded.frames;
        delays = decoded.delays;
      }
      const storedUrl = await storeUploadedFile(file, isGif ? 'gif' : 'paper');
      const sample: MemeSample = {
        id: `local-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, '') || 'Imported meme',
        blurb: isGif ? 'Live GIF from your computer' : 'Image from your computer',
        src: storedUrl,
        animation: config.animation === 'still' ? 'bounce' : config.animation,
        live: isGif,
        layers: (config.layers.length ? config.layers : defaultLayers).map((layer) => ({ ...layer })),
      };
      setLibraryMemes((current) => [sample, ...current]);
      setConfig((current) => ({
        ...current,
        template: isGif ? 'Custom GIF or image' : 'Custom image',
        customImage: frames?.[0] ?? storedUrl,
        gifSourceDataUrl: isGif ? storedUrl : undefined,
        gifFrames: frames,
        gifDelays: delays,
        photoMotion: 'still',
        effect: 'none',
        animation: sample.animation,
        campaignName: `${sample.name} campaign`,
      }));
      toast.success(isGif ? `${file.name} is playing live` : `${file.name} added`, {
        description: isGif ? 'Stored in Supabase. Edit the text only.' : 'Stored in Supabase. Pick a motion if you want it to move.',
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not import that meme.');
    } finally {
      event.target.value = '';
    }
  };

  const blankMemeState = () => ({
    template: 'Bold contrast' as const,
    customImage: undefined,
    gifSourceDataUrl: undefined,
    gifFrames: undefined,
    gifDelays: undefined,
    photoMotion: 'still' as const,
    effect: 'none' as const,
    animation: 'bounce' as const,
    imageCrop: { ...defaultCrop },
    layers: defaultLayers.map((layer) => ({ ...layer })),
  });

  const snapshotMeme = (current: StudioConfig) => ({
    template: current.template,
    customImage: current.customImage,
    gifSourceDataUrl: current.gifSourceDataUrl,
    gifFrames: current.gifFrames,
    gifDelays: current.gifDelays,
    photoMotion: current.photoMotion,
    effect: current.effect,
    animation: current.animation,
    campaignName: current.campaignName,
    layers: current.layers.map((layer) => ({ ...layer })),
    imageCrop: current.imageCrop ? { ...current.imageCrop } : { ...defaultCrop },
  });

  const restoreMeme = (sample: MemeSample | undefined, snapshot: ReturnType<typeof snapshotMeme>) => {
    if (sample) setLibraryMemes((current) => [sample, ...current.filter((item) => item.id !== sample.id)]);
    setConfig((current) => ({ ...current, ...snapshot }));
    if (snapshot.layers[0]) setActiveLayerId(snapshot.layers[0].id);
  };

  const removeLibraryMeme = (sample: MemeSample) => {
    const showing = config.gifSourceDataUrl === sample.src || config.customImage === sample.src;
    const snapshot = showing ? snapshotMeme(config) : null;
    setLibraryMemes((current) => current.filter((item) => item.id !== sample.id));
    if (showing) {
      setConfig((current) => ({ ...current, ...blankMemeState() }));
      setActiveLayerId('headline');
    }
    toast(`${sample.name} removed`, {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (snapshot) restoreMeme(sample, snapshot);
          else setLibraryMemes((current) => [sample, ...current.filter((item) => item.id !== sample.id)]);
        },
      },
    });
  };

  const removeCurrentMeme = () => {
    if (!config.customImage && !config.gifSourceDataUrl) return;
    const match = libraryMemes.find((sample) => sample.src === config.gifSourceDataUrl || sample.src === config.customImage);
    const snapshot = snapshotMeme(config);
    if (match) setLibraryMemes((current) => current.filter((item) => item.id !== match.id));
    setConfig((current) => ({ ...current, ...blankMemeState() }));
    setActiveLayerId('headline');
    toast(match ? `${match.name} removed` : 'Meme removed', {
      duration: 8000,
      action: { label: 'Undo', onClick: () => restoreMeme(match, snapshot) },
    });
  };

  const updateConfig = <K extends keyof StudioConfig>(key: K, value: StudioConfig[K]) =>
    setConfig((current) => ({ ...current, [key]: value }));

  const updateLayer = (patch: Partial<TextLayer>) =>
    setConfig((current) => ({
      ...current,
      layers: current.layers.map((layer) => (layer.id === activeLayerId ? { ...layer, ...patch } : layer)),
    }));

  const applyContacts = (rows: Contact[], source: string, overrides: { avatarColumn?: string; messageColumn?: string; fieldMap?: StudioConfig['fieldMap']; sourceColumns?: string[] } = {}) => {
    const prepared = prepareImportedContacts(rows);
    setContacts(prepared);
    setSelectedRow(0);
    persistContactList(contactsKey, prepared);
    const cols = contactColumns(prepared);
    const avatarCol = overrides.avatarColumn || guessAvatarColumn(cols, prepared);
    const msgCol = overrides.messageColumn || guessColumn(cols, messageColumnAliases);
    setConfig((current) => ({
      ...current,
      avatarColumn: mode === 'avatar' ? (avatarCol || current.avatarColumn) : current.avatarColumn,
      messageColumn: msgCol || current.messageColumn,
      fieldMap: overrides.fieldMap ?? current.fieldMap,
      listSource: source,
      sourceColumns: overrides.sourceColumns ?? current.sourceColumns ?? cols,
    }));
    const extras = [avatarCol && 'portraits', msgCol && 'message'].filter(Boolean);
    toast.success(`${prepared.length} contacts loaded from ${source}`, {
      description: extras.length ? `${extras.join(' + ')} come from the file.` : undefined,
    });
    if (mode === 'avatar' && avatarCol) {
      const gen = ++hydrateGen.current;
      const token = { cancelled: false };
      void hydratePortraits(prepared, avatarCol, (next, stats) => {
        if (hydrateGen.current !== gen) {
          token.cancelled = true;
          return;
        }
        setContacts(next);
        persistContactList(contactsKey, next);
        if (stats.done) {
          const kept = stats.cached;
          const pending = Math.max(0, stats.total - stats.cached);
          toast(kept ? `${prepared.length} cards ready` : `${prepared.length} cards ready`, {
            description: kept
              ? `${kept} portraits stored in this browser${pending ? `, ${pending} still on their original link` : ''}. Dead links will not wipe a stored photo.`
              : 'Portraits will show from the image links in the list.',
          });
        }
      }, token).catch(() => {
        if (hydrateGen.current === gen) toast(`${prepared.length} contacts loaded`, { description: 'Some portraits could not be copied yet, but the links still show.' });
      });
    }
  };

  useEffect(() => {
    if (mode !== 'avatar') return;
    const cols = contactColumns(contacts);
    const configured = config.avatarColumn && cols.includes(config.avatarColumn) ? config.avatarColumn : '';
    const column = configured || guessAvatarColumn(cols, contacts);
    if (!column) return;
    if (column !== config.avatarColumn) updateConfig('avatarColumn', column);
    const gen = ++hydrateGen.current;
    const token = { cancelled: false };
    void hydratePortraits(contacts, column, (next, stats) => {
      if (hydrateGen.current !== gen) {
        token.cancelled = true;
        return;
      }
      setContacts(next);
      persistContactList(contactsKey, next);
        if (stats.done && stats.cached) {
          persistContactList(contactsKey, next);
        }
    }, token);
    return () => {
      token.cancelled = true;
    };
    // Restore once when the desk opens — later imports run their own hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, contactsKey]);

  // Desk → "Load sample list" hand-off.
  useEffect(() => {
    if (!consumeSampleListRequest(scope)) return;
    loadSampleList()
      .then((imported) => applyContacts(imported.rows, 'messy-prospects.csv', { sourceColumns: imported.columns }))
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'The sample list could not be loaded.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const onImportResult = (result: ImportResult) => {
    setError('');
    const destinations = result.destinations?.length ? result.destinations : [mode];
    const prepared = prepareImportedContacts(result.rows);
    persistContactsForModes(scope, destinations, prepared);
    persistListMeta(scope, destinations, {
      fieldMap: result.fieldMap,
      listSource: result.source,
      sourceColumns: result.sourceColumns,
      avatarColumn: result.avatarColumn,
      messageColumn: result.messageColumn,
    });
    const nextConfig = {
      ...config,
      avatarColumn: result.avatarColumn || config.avatarColumn,
      messageColumn: result.messageColumn || config.messageColumn,
      fieldMap: result.fieldMap,
      listSource: result.source,
      sourceColumns: result.sourceColumns,
    };
    const openMode = destinations.includes(mode) ? mode : destinations[0];
    if (destinations.includes(mode)) {
      applyContacts(result.rows, result.source, {
        avatarColumn: result.avatarColumn,
        messageColumn: result.messageColumn,
        fieldMap: result.fieldMap,
        sourceColumns: result.sourceColumns,
      });
    } else {
      toast.success(`Opening ${studioLabel(openMode)}`, {
        description: `${prepared.length} rows saved for ${destinations.map(studioLabel).join(', ')}.`,
      });
    }
    void (async () => {
      try {
        const columns = result.sourceColumns.length ? result.sourceColumns : contactColumns(prepared);
        let opened: SavedCampaign | null = null;
        let syncError = '';
        for (const dest of destinations) {
          const prior = peekLocalCampaign(dest, userId);
          const destConfig = dest === mode
            ? nextConfig
            : {
              ...normalizeConfig(dest, prior?.config ?? defaultConfig(dest)),
              fieldMap: result.fieldMap,
              listSource: result.source,
              sourceColumns: result.sourceColumns,
              avatarColumn: dest === 'avatar' ? (result.avatarColumn || prior?.config.avatarColumn) : prior?.config.avatarColumn,
              messageColumn: result.messageColumn || prior?.config.messageColumn,
              id: prior?.id,
              campaignName: prior?.name || `${modeLabel(dest)} campaign`,
            };
          const saved = await saveCampaign(destConfig, columns, prepared, userId);
          if (dest === mode) setConfig(saved.config);
          if (dest === openMode) opened = saved;
          if (saved.syncError) syncError = saved.syncError;
        }
        if (result.sourceFile && userId && supabaseConfigured) {
          try {
            const stored = await persistImportedList(
              result.sourceFile,
              result.sourceFile.name || result.source,
              userId,
              opened?.cloud ? opened.id : undefined,
            );
            setConfig((current) => ({ ...current, sourceFileUrl: stored.publicUrl, listSource: result.source }));
            toast.success(`Stored ${result.sourceFile.name} in Supabase`, {
              description: 'Each import is a new file. Previous lists stay.',
            });
          } catch (reason) {
            toast('List is on the campaign', {
              description: reason instanceof Error ? reason.message : 'The spreadsheet file could not be stored in Supabase.',
            });
          }
        }
        if (syncError) setError(`List saved locally, but cloud sync failed: ${syncError}`);
        if (openMode !== mode && opened) {
          localStorage.setItem(`gtm-studio-load-campaign:${scope}`, JSON.stringify(opened));
          navigate(modeHref(openMode));
        } else if (!syncError) {
          toast.success(opened?.cloud ? 'List saved to Supabase' : 'List saved in this browser', {
            description: `Make a ${studioLabel(openMode)} template, then generate for every row.`,
          });
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not save that list to Supabase.');
      }
    })();
  };

  const openList = (step: ImportStep = 'source') => {
    setListStep(step);
    setListOpen(true);
  };

  const writeContactAvatar = (source: string, cache?: string) => {
    const column = config.avatarColumn || guessAvatarColumn(columns, contacts) || 'avatar';
    setContacts((rows) => {
      const next = rows.map((row, index) => (
        index === selectedRow
          ? {
              ...row,
              [column]: source,
              [AVATAR_SOURCE_FIELD]: source,
              [AVATAR_CACHE_FIELD]: cache?.startsWith('data:') ? cache : (source ? row[AVATAR_CACHE_FIELD] ?? '' : ''),
            }
          : row
      ));
      persistContactList(contactsKey, next);
      return next;
    });
    return column;
  };

  const applyAvatarSource = async (source: string, label?: string) => {
    const trimmed = source.trim();
    if (!trimmed) throw new Error('Paste an image link or choose a photo first.');
    const looksLikeUrl = /^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('/') || trimmed.startsWith('blob:');
    if (!looksLikeUrl) throw new Error('Use a full image link starting with https://, or upload a photo.');
    const cached = await snapshotPortrait(trimmed);
    const loaded = Boolean(cached) || await probeImage(trimmed);
    if (!loaded && !/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('data:') && !trimmed.startsWith('/')) {
      throw new Error('That photo could not be loaded. Upload the file if the website blocks links.');
    }
    const column = writeContactAvatar(trimmed, cached);
    setConfig((current) => ({
      ...current,
      avatarColumn: column,
      avatarImage: cached || ((trimmed.startsWith('data:') || trimmed.startsWith('blob:')) ? trimmed : current.avatarImage),
      avatarUrl: /^https?:\/\//i.test(trimmed) ? trimmed : current.avatarUrl,
    }));
    setError('');
    toast.success(label ? `${label} is on this row’s portrait` : 'Portrait updated for this row', {
      description: cached ? 'Stored in this browser — a dead link will not wipe it.' : undefined,
    });
  };

  const applyAvatarLink = async () => {
    try {
      await applyAvatarSource(config.avatarUrl ?? '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not use that image link.');
    }
  };

  const clearRowAvatar = () => {
    const previousRow = contacts[selectedRow];
    const previousConfig = { avatarImage: config.avatarImage, avatarUrl: config.avatarUrl };
    const rowIndex = selectedRow;
    writeContactAvatar('');
    setConfig((current) => ({ ...current, avatarImage: undefined, avatarUrl: '' }));
    toast('Portrait cleared for this row', {
      description: 'Add a photo or a link, or undo.',
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (!previousRow) return;
          setContacts((rows) => {
            const next = rows.map((row, index) => (index === rowIndex ? { ...previousRow } : row));
            persistContactList(contactsKey, next);
            return next;
          });
          setConfig((current) => ({ ...current, ...previousConfig }));
        },
      },
    });
  };

  const addAvatarFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.');
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|svg)$/i.test(file.name)) {
      throw new Error('Use a PNG, JPG, WEBP, GIF or SVG photo.');
    }
    await applyAvatarSource(await fileAsDataUrl(file), file.name);
  };

  const applyDrawnSignature = async (dataUrl: string) => {
    if (config.signatureImage) await removeStoredImage(config.signatureImage, userId);
    if (userId && supabaseConfigured) {
      try {
        const stored = await persistStudioImage(dataUrl, 'signature', userId, config.id);
        updateConfig('signatureImage', stored.publicUrl);
        toast.success('Drawn signature saved to Supabase');
        return;
      } catch (reason) {
        toast('Signature kept in this browser', { description: reason instanceof Error ? reason.message : 'Upload failed.' });
      }
    }
    updateConfig('signatureImage', dataUrl);
    toast.success('Drawn signature added');
  };

  const storeUploadedFile = async (file: File, kind: 'desk' | 'paper' | 'signature' | 'gif') => {
    if (userId && supabaseConfigured) {
      try {
        const stored = await persistStudioImage(file, kind, userId, config.id);
        return stored.publicUrl;
      } catch (reason) {
        toast('Saved in this browser', { description: reason instanceof Error ? reason.message : 'Supabase upload failed.' });
      }
    }
    return fileAsDataUrl(file);
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>, target: 'background' | 'signature' | 'avatar' | 'desk') => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (target === 'avatar') {
        await addAvatarFile(file);
        return;
      }
      if (file.size > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.');
      if ((mode === 'gif' || mode === 'memes') && target === 'background' && file.type === 'image/gif') {
        const decoded = await decodeGifFile(file);
        const storedUrl = await storeUploadedFile(file, 'gif');
        setConfig((current) => ({
          ...current,
          gifSourceDataUrl: storedUrl,
          gifFrames: decoded.frames,
          gifDelays: decoded.delays,
          customImage: decoded.frames[0],
          template: mode === 'gif' ? 'Custom GIF or image' : 'Custom image',
          photoMotion: 'still',
        }));
        toast.success(`${file.name} is playing live`, { description: userId && supabaseConfigured ? `${decoded.frames.length} frames · stored in Supabase.` : `${decoded.frames.length} frames.` });
        return;
      }
      const storedUrl = await storeUploadedFile(file, target === 'signature' ? 'signature' : target === 'desk' ? 'desk' : 'paper');
      if (target === 'signature') {
        if (config.signatureImage) await removeStoredImage(config.signatureImage, userId);
        updateConfig('signatureImage', storedUrl);
        toast.success(`${file.name} is ready in the canvas`, { description: userId && supabaseConfigured ? 'Stored in Supabase.' : undefined });
        return;
      }
      if (target === 'desk') {
        if (config.deskImage) await removeStoredImage(config.deskImage, userId);
        updateConfig('deskImage', storedUrl);
        toast.success(`${file.name} is the desk background`, { description: userId && supabaseConfigured ? 'Stored in Supabase.' : undefined });
        return;
      }
      if (config.customImage) await removeStoredImage(config.customImage, userId);
      setConfig((current) => ({ ...current, customImage: storedUrl }));
      toast.success(`${file.name} is on the paper`, { description: userId && supabaseConfigured ? 'Stored in Supabase.' : undefined });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Image upload failed.');
    } finally {
      event.target.value = '';
    }
  };

  const clearUploadedImage = (target: 'background' | 'signature' | 'desk') => {
    const url = target === 'signature' ? config.signatureImage : target === 'desk' ? config.deskImage : (config.gifSourceDataUrl || config.customImage);
    void removeStoredImage(url, userId);
    if (target === 'signature') {
      updateConfig('signatureImage', undefined);
      toast('Signature image removed');
      return;
    }
    if (target === 'desk') {
      updateConfig('deskImage', undefined);
      toast('Desk background removed');
      return;
    }
    setConfig((current) => ({
      ...current,
      customImage: undefined,
      gifSourceDataUrl: undefined,
      gifFrames: undefined,
      gifDelays: undefined,
    }));
    toast('Uploaded image removed');
  };

  useEffect(() => {
    if (mode === 'handwritten' || mode === 'handgif') return;
    const onPaste = async (event: ClipboardEvent) => {
      const file = [...event.clipboardData?.files ?? []].find((item) => item.type.startsWith('image/'));
      if (!file) return;
      event.preventDefault();
      try {
        if ((mode === 'gif' || mode === 'memes') && file.type === 'image/gif') {
          const decoded = await decodeGifFile(file);
          const dataUrl = await fileAsDataUrl(file);
          setConfig((current) => ({ ...current, gifFrames: decoded.frames, gifDelays: decoded.delays, customImage: decoded.frames[0], gifSourceDataUrl: dataUrl, template: current.template }));
          toast.success('Pasted GIF is playing live', { description: `${decoded.frames.length} frames.` });
        } else if (mode === 'avatar') {
          await addAvatarFile(file);
        } else {
          const dataUrl = await fileAsDataUrl(file);
          setConfig((current) => ({ ...current, customImage: dataUrl, template: 'Custom image' }));
          toast.success('Pasted image added to the canvas');
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Pasted image could not be read.');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const uploadFont = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const name = `Custom-${file.name.replace(/\W+/g, '-')}`;
      const face = new FontFace(name, await file.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      updateConfig('fontFamily', name);
      updateConfig('customFontDataUrl', await fileAsDataUrl(file));
      toast.success(`${file.name} is now the handwriting font`);
    } catch {
      setError('That font could not be loaded. Use TTF, OTF, WOFF, or WOFF2.');
    } finally {
      event.target.value = '';
    }
  };

  const addLayer = () => {
    const layer: TextLayer = {
      id: crypto.randomUUID(),
      name: `Text ${config.layers.length + 1}`,
      text: '{company}',
      x: 0.12,
      y: 0.48,
      width: 0.76,
      height: 0.16,
      fontSize: 46,
      align: 'center',
      color: '#ffffff',
      outline: true,
      animation: 'still',
      highlight: '',
      highlightColor: '#ffe566',
    };
    setConfig((current) => ({ ...current, layers: [...current.layers, layer] }));
    setActiveLayerId(layer.id);
  };

  const removeLayer = () => {
    if (config.layers.length <= 1) return;
    const removed = config.layers.find((layer) => layer.id === activeLayerId);
    const removedIndex = config.layers.findIndex((layer) => layer.id === activeLayerId);
    const next = config.layers.filter((layer) => layer.id !== activeLayerId);
    setConfig((current) => ({ ...current, layers: next }));
    setActiveLayerId(next[0]?.id ?? '');
    if (removed) {
      toast(`${removed.name} removed`, {
        duration: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            setConfig((current) => {
              const layers = [...current.layers];
              layers.splice(Math.min(removedIndex, layers.length), 0, removed);
              return { ...current, layers };
            });
            setActiveLayerId(removed.id);
          },
        },
      });
    }
  };

  const insertTag = (tag: string) => {
    if (mode === 'handwritten' || mode === 'avatar' || mode === 'handgif') updateConfig('copy', `${config.copy}${config.copy.endsWith(' ') ? '' : ' '}${tag}`);
    else updateLayer({ text: `${activeLayer?.text ?? ''}${activeLayer?.text.endsWith(' ') ? '' : ' '}${tag}` });
  };

  const saveCurrentCampaign = async () => {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      const saved = await saveCampaign(config, listExportColumns(contacts, config.sourceColumns, mode), contacts, userId);
      setConfig(saved.config);
      if (saved.contacts?.length) {
        setContacts(saved.contacts);
        persistContactList(contactsKey, saved.contacts);
      }
      if (saved.syncError) {
        setError(`Campaign saved locally, but cloud sync failed: ${saved.syncError}`);
        toast('Campaign preserved locally');
      } else {
        toast.success(saved.cloud ? 'Campaign saved to the cloud' : 'Campaign saved in this browser', { description: 'Stored portraits are included.' });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Campaign save failed.');
    } finally {
      setSaving(false);
    }
  };

  const saveTemplate = async () => {
    if (savingTemplate) return;
    setSavingTemplate(true);
    try {
      const saved = await saveTemplateConfig({ ...config, mode }, userId);
      if (saved.config) setConfig((current) => ({ ...current, templateId: saved.id, campaignName: saved.config.campaignName }));
      setSavedTemplates(await listTemplateConfigs(userId));
      if (saved.syncError) setError(`Template preserved locally, but cloud sync failed: ${saved.syncError}`);
      toast.success(saved.cloud ? 'Template saved to Supabase for this studio' : 'Template saved in this browser for this studio');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Template save failed.');
    } finally {
      setSavingTemplate(false);
    }
  };

  const loadTemplate = async (template: SavedTemplate) => {
    const value = { ...template.config, templateId: template.id, campaignName: template.name, mode };
    if (mode === 'gif' && value.gifSourceDataUrl && !value.gifFrames?.length) {
      try {
        const blob = await (await fetch(value.gifSourceDataUrl)).blob();
        const decoded = await decodeGifFile(new File([blob], 'template.gif', { type: 'image/gif' }));
        setConfig({ ...normalizeConfig(mode, value), gifFrames: decoded.frames, gifDelays: decoded.delays, customImage: decoded.frames[0] });
      } catch {
        setConfig(normalizeConfig(mode, value));
        setError('The saved GIF source could not be decoded; its first frame is still available.');
      }
    } else setConfig(normalizeConfig(mode, value));
    toast(`${template.name} loaded`);
  };

  const duplicateTemplate = async (template: SavedTemplate) => {
    try {
      const saved = await copyTemplateConfig(template, userId);
      setSavedTemplates(await listTemplateConfigs(userId));
      if (saved.config) {
        setConfig(normalizeConfig(mode, { ...saved.config, mode }));
        toast.success(saved.cloud ? `${saved.config.campaignName} copied to Supabase` : `${saved.config.campaignName} copied in this browser`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not copy that template.');
    }
  };

  const paperMode = mode === 'handwritten' || mode === 'avatar' || mode === 'handgif';
  const avatarMode = mode === 'avatar';
  const cutMode = mode === 'memes' || mode === 'gif';
  const handwritingMode = mode === 'handwritten' || mode === 'handgif';

  const applyFinish = (finish: StudioConfig['finish']) => {
    const note = finishPaperZone(finish);
    setConfig((current) => {
      if (mode === 'avatar') {
        const layout = avatarInNoteLayout(current.channel, current.avatarZone.width, note);
        return { ...current, finish, noteZone: layout.note, avatarZone: layout.avatar, textZone: layout.text };
      }
      return { ...current, finish, noteZone: note };
    });
  };

  const applyPaperKind = (kind: PaperKind) => {
    setConfig((current) => {
      const keepColor = current.paperColorPreset === 'custom';
      const nextPreset = keepColor ? 'custom' : kind === 'white-paper' ? 'white' : 'cream';
      const preset = paperColorPresets.find((item) => item.id === nextPreset);
      return {
        ...current,
        paperKind: kind,
        template: kind === 'notebook' ? 'Notebook' : kind === 'diary' ? 'Diary' : 'White paper',
        ruledLines: kind !== 'white-paper',
        showMargin: kind === 'notebook',
        paperColorPreset: nextPreset,
        paperColor: keepColor ? current.paperColor : (preset?.hex || current.paperColor),
        noteY: kind === 'diary' ? Math.max(current.noteY, 0.2) : current.noteY,
      };
    });
  };

  const applyPaperColor = (preset: PaperColorPreset) => {
    const swatch = paperColorPresets.find((item) => item.id === preset);
    setConfig((current) => ({
      ...current,
      paperColorPreset: preset,
      paperColor: preset === 'custom' ? current.paperColor : (swatch?.hex || current.paperColor),
    }));
  };

  const zoneValue = (kind: ZoneKind) => {
    if (kind === 'website') return config.websiteZone;
    if (kind === 'avatar') return config.avatarZone;
    if (kind === 'note') return config.noteZone;
    if (paperMode) return config.textZone ?? { x: 0.4, y: 0.14, width: 0.46, height: 0.7 };
    return { x: activeLayer?.x ?? 0, y: activeLayer?.y ?? 0, width: activeLayer?.width ?? .4, height: activeLayer?.height ?? .16 };
  };
  const setZoneValue = (kind: ZoneKind, zone: { x: number; y: number; width: number; height: number }) => {
    const bounded = {
      x: Math.max(0, Math.min(.95, zone.x)),
      y: Math.max(0, Math.min(.95, zone.y)),
      width: Math.max(.08, Math.min(1 - zone.x, zone.width)),
      height: Math.max(.06, Math.min(1 - zone.y, zone.height)),
    };
    if (kind === 'website') updateConfig('websiteZone', bounded);
    else if (kind === 'avatar') updateConfig('avatarZone', clampZoneInside(bounded, config.noteZone));
    else if (kind === 'note') {
      setConfig((current) => {
        const dx = bounded.x - current.noteZone.x;
        const dy = bounded.y - current.noteZone.y;
        return {
          ...current,
          noteZone: bounded,
          avatarZone: clampZoneInside(shiftZone(current.avatarZone, dx, dy), bounded),
          textZone: clampZoneInside(shiftZone(current.textZone, dx, dy), bounded),
        };
      });
    } else if (paperMode) updateConfig('textZone', clampZoneInside(bounded, config.noteZone));
    else updateLayer({ x: bounded.x, y: bounded.y, width: bounded.width, height: bounded.height });
  };
  const beginZoneDrag = (event: React.PointerEvent, kind: ZoneKind, resize: boolean) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveCanvasZone(kind);
    dragRef.current = {
      kind,
      resize,
      startX: event.clientX,
      startY: event.clientY,
      zone: zoneValue(kind),
      companions: kind === 'note' ? { avatar: config.avatarZone, text: config.textZone } : undefined,
    };
  };
  const beginCropDrag = (event: React.PointerEvent) => {
    if (cropMode === 'off') return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const crop = cropMode === 'avatar' ? (config.avatarCrop ?? defaultCrop) : (config.imageCrop ?? defaultCrop);
    const zoom = crop.zoom < 1.25 ? 1.3 : crop.zoom;
    if (zoom !== crop.zoom) {
      updateConfig(cropMode === 'avatar' ? 'avatarCrop' : 'imageCrop', { ...crop, zoom });
    }
    dragRef.current = {
      kind: cropMode === 'avatar' ? 'crop-avatar' : 'crop-image',
      resize: false,
      startX: event.clientX,
      startY: event.clientY,
      zone: { x: crop.x, y: crop.y, width: zoom, height: 0 },
    };
  };
  const moveZone = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (drag.kind === 'crop-image' || drag.kind === 'crop-avatar') {
      const frame = drag.kind === 'crop-avatar'
        ? config.avatarZone
        : paperMode
          ? config.noteZone
          : { width: 1, height: 1 };
      const spanX = Math.max(0.18, frame.width) * rect.width;
      const spanY = Math.max(0.18, frame.height) * rect.height;
      const zoomRoom = Math.max(0.2, drag.zone.width - 1);
      const dx = ((event.clientX - drag.startX) / spanX) / zoomRoom;
      const dy = ((event.clientY - drag.startY) / spanY) / zoomRoom;
      const next: CropFocus = {
        zoom: drag.zone.width,
        x: Math.max(0, Math.min(1, drag.zone.x - dx)),
        y: Math.max(0, Math.min(1, drag.zone.y - dy)),
      };
      updateConfig(drag.kind === 'crop-avatar' ? 'avatarCrop' : 'imageCrop', next);
      return;
    }
    const dx = (event.clientX - drag.startX) / rect.width;
    const dy = (event.clientY - drag.startY) / rect.height;
    setZoneValue(drag.kind, drag.resize
      ? { ...drag.zone, width: drag.zone.width + dx, height: drag.zone.height + dy }
      : { ...drag.zone, x: drag.zone.x + dx, y: drag.zone.y + dy });
  };

  const toggleCrop = (kind: 'image' | 'avatar') => {
    if (cropMode === kind) {
      setCropMode('off');
      return;
    }
    if (kind === 'avatar' && !avatarSource) {
      toast('Add an avatar photo or link first', { description: 'Then crop it from here.' });
      return;
    }
    if (kind === 'image' && !config.customImage && !config.gifSourceDataUrl) {
      toast(mode === 'memes' || mode === 'gif' ? 'Add a photo or GIF first' : 'Add a paper photo first', {
        description: mode === 'memes' || mode === 'gif' ? 'Then crop it from here.' : 'Use Crop avatar for the portrait.',
      });
      return;
    }
    const key = kind === 'avatar' ? 'avatarCrop' : 'imageCrop';
    const crop = (kind === 'avatar' ? config.avatarCrop : config.imageCrop) ?? defaultCrop;
    if (crop.zoom < 1.3) updateConfig(key, { ...crop, zoom: 1.3 });
    setCropMode(kind);
    setDeskTab('look');
  };

  const renderOne = async (current: Contact, signal?: AbortSignal) => {
    const extension = exportIsAnimated(mode, config) ? 'gif' : 'png';
    const blob = exportIsAnimated(mode, config)
      ? await renderGifAsset(config, current, signal)
      : mode === 'handwritten' || mode === 'avatar'
        ? await renderStaticAsset(config, current)
        : await (staticWorkerRef.current ?? (staticWorkerRef.current = createBatchRenderer())).render(config, current);
    return {
      id: crypto.randomUUID(),
      row: current.row,
      filename: safeFilename(config.filename, current, extension),
      blob,
      url: URL.createObjectURL(blob),
      bytes: blob.size,
      selected: true,
      status: blob.size > 200_000 ? 'warning' : 'ready',
    } as GeneratedAsset;
  };

  const renderBatch = async (startIndex = 0, keep: GeneratedAsset[] = []) => {
    setError('');
    setGenerating(true);
    cancelRef.current = false;
    const controller = new AbortController();
    batchControllerRef.current = controller;
    if (!keep.length) assets.forEach((asset) => URL.revokeObjectURL(asset.url));
    const generated: GeneratedAsset[] = [...keep];
    const batchContacts = contacts.slice(0, 400);
    setProgressTotal(batchContacts.length);
    setProgressDone(generated.length);
    setProgress(Math.round((generated.length / Math.max(1, batchContacts.length)) * 100));
    setEtaSeconds(null);
    batchStartRef.current = performance.now();
    const alreadyDone = generated.length;
    if (mode !== 'handwritten' && mode !== 'avatar' && !exportIsAnimated(mode, config)) {
      staticWorkerRef.current = createBatchRenderer();
    }
    for (let index = startIndex; index < batchContacts.length; index++) {
      if (cancelRef.current) break;
      const current = batchContacts[index];
      try {
        generated.push(await renderOne(current, controller.signal));
      } catch (reason) {
        if (controller.signal.aborted) break;
        generated.push({
          id: crypto.randomUUID(),
          row: current.row,
          filename: safeFilename(config.filename, current, exportIsAnimated(mode, config) ? 'gif' : 'png'),
          blob: new Blob(),
          url: '',
          bytes: 0,
          selected: false,
          status: 'failed',
          error: reason instanceof Error ? reason.message : 'Generation failed.',
        });
      }
      const done = index + 1;
      setProgressDone(done);
      setProgress(Math.round((done / batchContacts.length) * 100));
      const elapsed = (performance.now() - batchStartRef.current) / 1000;
      const finishedThisRun = done - alreadyDone;
      if (finishedThisRun > 0) setEtaSeconds(Math.max(0, Math.round((elapsed / finishedThisRun) * (batchContacts.length - done))));
    }
    setAssets(generated);
    staticWorkerRef.current?.terminate();
    staticWorkerRef.current = null;
    batchControllerRef.current = null;
    if (cancelRef.current) {
      const resumeFrom = generated.length;
      toast(`Cancelled with ${generated.length} completed assets kept`, {
        duration: 8000,
        action: resumeFrom < batchContacts.length
          ? { label: 'Resume', onClick: () => { void renderBatch(resumeFrom, generated); } }
          : undefined,
      });
    } else {
      toast.success(`${generated.length} assets ready for review${contacts.length > 400 ? ' (first 400 rows)' : ''}`);
    }
    try {
      const stamped = await writeBackOutputs(generated);
      if (!cancelRef.current && generated.some((asset) => asset.status !== 'failed')) setReviewOpen(true);
      return { generated, contacts: stamped };
    } finally {
      setGenerating(false);
    }
  };

  const writeBackOutputs = async (generated: GeneratedAsset[], rows = contacts, quiet = false) => {
    if (!generated.length) return rows;
    let nextAssets = generated;
    const uploadable = generated.filter((asset) => asset.status !== 'failed' && asset.blob.size && !asset.publicUrl);
    if (userId && supabaseConfigured && uploadable.length) {
      try {
        if (!quiet) toast('Uploading generated files to Supabase…');
        const uploaded = await uploadGeneratedAssets(uploadable, config.campaignName, userId, { campaignId: config.id, mode });
        const byId = new Map(uploaded.map((asset) => [asset.id, asset]));
        nextAssets = generated.map((asset) => byId.get(asset.id) ?? asset);
        const failedUploads = uploaded.filter((asset) => asset.uploadStatus === 'failed').length;
        if (failedUploads) {
          toast(`${failedUploads} files stayed local`, { description: 'Filenames are on the list. Retry Save if the upload failed.' });
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not upload generated files to Supabase.');
      }
    }
    setAssets((current) => {
      if (!current.length) return nextAssets;
      const byId = new Map(nextAssets.map((asset) => [asset.id, asset]));
      const byRow = new Map(nextAssets.map((asset) => [asset.row, asset]));
      const merged = current.map((asset) => byId.get(asset.id) ?? byRow.get(asset.row) ?? asset);
      const extras = nextAssets.filter((asset) => !merged.some((item) => item.id === asset.id || item.row === asset.row));
      return extras.length ? [...merged, ...extras] : merged;
    });
    const stamped = stampStudioOutputs(rows, nextAssets, mode);
    const nextConfig = withOutputFieldMap(config, mode);
    setContacts(stamped);
    persistContactList(contactsKey, stamped);
    persistListMeta(scope, [mode], {
      fieldMap: nextConfig.fieldMap,
      listSource: nextConfig.listSource,
      sourceColumns: nextConfig.sourceColumns,
      avatarColumn: nextConfig.avatarColumn,
      messageColumn: nextConfig.messageColumn,
    });
    setConfig(nextConfig);
    try {
      const saved = await saveCampaign(nextConfig, listExportColumns(stamped, nextConfig.sourceColumns, mode), stamped, userId);
      if (saved.config.id !== config.id) setConfig((current) => ({ ...current, id: saved.config.id, fieldMap: nextConfig.fieldMap }));
      if (saved.syncError) setError(`Assets are on the list locally, but cloud sync failed: ${saved.syncError}`);
      else if (!quiet) {
        const cols = outputColumnNames(mode).slice(0, 2).join(' and ');
        toast.success(saved.cloud ? `List updated in Supabase with ${cols}` : `List updated with ${cols}`, {
          description: 'Download the ZIP or list CSV to get the generated file names and links.',
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the updated list.');
    }
    return stamped;
  };

  const generateBatch = async () => {
    if (generating) {
      cancelRef.current = true;
      batchControllerRef.current?.abort();
      staticWorkerRef.current?.terminate();
      return;
    }
    await renderBatch();
  };

  const openBatchReview = async () => {
    if (generating) return;
    if (!assets.length && userId && supabaseConfigured) {
      try {
        const stored = await listStudioAssets(userId, mode, config.id, config.campaignName);
        if (stored.length) {
          setAssets(stored);
          setReviewOpen(true);
          return;
        }
      } catch {
        // Generate below if the cloud list is empty or unavailable.
      }
    }
    if (!assets.length) {
      await generateBatch();
      return;
    }
    setReviewOpen(true);
  };

  const retryAsset = async (asset: GeneratedAsset) => {
    const row = contacts.find((item) => item.row === asset.row);
    if (!row) return;
    try {
      const fresh = await renderOne(row);
      setAssets((current) => current.map((item) => (item.id === asset.id ? fresh : item)));
      await writeBackOutputs([{ ...fresh, id: asset.id }], contacts);
      toast.success(`Row ${asset.row} rendered`);
    } catch (reason) {
      setAssets((current) => current.map((item) => (item.id === asset.id ? { ...item, error: reason instanceof Error ? reason.message : 'Generation failed.' } : item)));
    }
  };

  const zipAndSave = async (selected: GeneratedAsset[], label: string, list = contacts) => {
    if (!selected.length) {
      setError('Select at least one generated asset.');
      return;
    }
    const zip = new JSZip();
    const packed = await Promise.all(selected.map((asset) => ensureAssetBlob(asset)));
    packed.forEach((asset) => zip.file(asset.filename, asset.blob));
    const stamped = stampStudioOutputs(list, packed, mode);
    const exported = exportListCsv(stamped, config, mode);
    zip.file('prospects.csv', exported.csv);
    if (exported.filename !== 'prospects.csv') zip.file(exported.filename, exported.csv);
    const manifest = packed.map((asset) => ({
      row: asset.row,
      filename: asset.filename,
      bytes: asset.bytes,
      image_url: asset.publicUrl ?? String(stamped.find((row) => row.row === asset.row)?.image_url ?? ''),
      smartlead_image_url: asset.publicUrl ?? String(stamped.find((row) => row.row === asset.row)?.smartlead_image_url ?? ''),
    }));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    saveAs(await zip.generateAsync({ type: 'blob' }), `${config.campaignName.replace(/\W+/g, '-') || 'campaign'}.zip`);
    recordExport(scope, selected.length);
    toast.success(`${selected.length} assets downloaded in a ZIP${label}`, {
      description: `${exported.filename} includes the generated file names and links.`,
    });
  };

  const downloadZip = async () => {
    await zipAndSave(assets.filter((asset) => asset.selected && asset.status !== 'failed'), '');
  };

  const downloadThisRow = async () => {
    if (downloading) return;
    setError('');
    try {
      setDownloading(true);
      setPreviewing(true);
      const asset = await renderOne(contact);
      saveAs(asset.blob, asset.filename);
      URL.revokeObjectURL(asset.url);
      recordExport(scope, 1);
      await writeBackOutputs([asset], contacts, true);
      toast.success(`Downloaded ${asset.filename}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not download this row.');
    } finally {
      setPreviewing(false);
      setDownloading(false);
    }
  };

  const downloadAll = async () => {
    const result = assets.length
      ? { generated: assets.filter((asset) => asset.status !== 'failed'), contacts }
      : await renderBatch();
    const pack = result.generated.filter((asset) => asset.status !== 'failed');
    await zipAndSave(pack, ' (all rows)', result.contacts);
  };

  const downloadListCsv = () => {
    if (!contacts.length) {
      setError('Import a list first.');
      return;
    }
    const exported = exportListCsv(contacts, config, mode);
    const blob = new Blob([exported.csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, exported.filename);
    toast.success(`Downloaded ${exported.filename}`, {
      description: 'Original columns plus generated file names and links.',
    });
  };

  const downloadAsset = async (asset: GeneratedAsset) => {
    try {
      const ready = await ensureAssetBlob(asset);
      if (!ready.blob.size) return;
      saveAs(ready.blob, ready.filename);
      recordExport(scope, 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not download that file from Supabase.');
    }
  };

  const compressWarnings = async () => {
    if (animatedExport) {
      setError('Animated export is skipped for compression. Reduce source dimensions or frame count instead.');
      return;
    }
    const before = assets;
    const next: GeneratedAsset[] = [];
    for (const asset of assets) {
      if (asset.status !== 'warning' || !asset.url) {
        next.push(asset);
        continue;
      }
      const bitmap = await createImageBitmap(asset.blob);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * 0.82);
      canvas.height = Math.round(bitmap.height * 0.82);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const compressed = await canvasToBlob(canvas, 'image/webp', 0.76);
      bitmap.close();
      next.push({
        ...asset,
        filename: asset.filename.replace(/\.[^.]+$/, '.webp'),
        blob: compressed,
        url: URL.createObjectURL(compressed),
        bytes: compressed.size,
        status: compressed.size > 200_000 ? 'warning' : 'ready',
      });
    }
    setAssets(next);
    let undone = false;
    toast.success('Large static assets compressed to WebP', {
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          next.forEach((asset, index) => {
            if (asset.url && asset.url !== before[index]?.url) URL.revokeObjectURL(asset.url);
          });
          setAssets(before);
        },
      },
      onAutoClose: () => {
        if (!undone) before.forEach((asset, index) => { if (asset.url && asset.url !== next[index]?.url) URL.revokeObjectURL(asset.url); });
      },
    });
  };

  // Keyboard shortcuts for the operator loop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveCurrentCampaign();
        return;
      }
      if (meta && event.key === 'Enter') {
        event.preventDefault();
        void generateBatch();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) {
        if (event.key === 'Escape') setCropMode('off');
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setSelectedRow((value) => Math.max(0, value - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSelectedRow((value) => Math.min(contacts.length - 1, value + 1));
      } else if (event.key === '1' || event.key === '2' || event.key === '3') {
        setDeskTab((['copy', 'look', 'ship'] as DeskTab[])[Number(event.key) - 1]);
        if (!desktop) setInspectorOpen(true);
      } else if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
      } else if (event.key.toLowerCase() === 'i' && !meta) {
        event.preventDefault();
        openList('source');
      } else if (event.key === 'Escape' && cropMode !== 'off') {
        setCropMode('off');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const landscape = config.channel === 'Email' || config.channel === 'Widescreen' || config.channel === 'Classic';
  const activeCrop = cropMode === 'avatar' ? (config.avatarCrop ?? defaultCrop) : (config.imageCrop ?? defaultCrop);
  const liveMotion = usesLivePreview(config);
  const liveLabel = isLiveGif(config)
    ? 'Live GIF'
    : mode === 'handgif'
      ? 'Writing'
      : mode === 'avatar' && (config.textMotion ?? 'still') !== 'still'
        ? (textMotions.find((item) => item.id === config.textMotion)?.label ?? 'Auto writing')
        : config.photoMotion && config.photoMotion !== 'still'
          ? config.photoMotion
          : config.animation;
  const canvasDims = dimensions[config.channel];
  const gifEstimateKb = Math.round(canvasDims.width * canvasDims.height * (config.gifFrames?.length ?? 12) * (.006 + config.gifQuality * .001) / 1024);
  const copyLines = config.copy.split('\n').length;
  const templatesForMode = savedTemplates.filter((item) => item.mode === mode);
  const batchSize = Math.min(contacts.length, 400);

  const cropPopover = (kind: 'image' | 'avatar', trigger: ReactNode) => (
    <Popover open={cropMode === kind} onOpenChange={(open) => { if (!open) setCropMode('off'); }} modal={false}>
      <PopoverAnchor asChild>{trigger}</PopoverAnchor>
      <PopoverContent
        align="end"
        sideOffset={8}
        onInteractOutside={(event) => event.preventDefault()}
        className="w-[min(360px,calc(100vw-32px))] rounded-[12px] border-border bg-card p-4 shadow-[var(--shadow-overlay)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{kind === 'avatar' ? 'Crop avatar' : cutMode ? 'Crop photo' : 'Crop paper photo'}</p>
            <p className="helper mt-1">Drag on the stage to pan · scroll to zoom</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Done cropping" onClick={() => setCropMode('off')}><X size={16} aria-hidden /></button>
        </div>
        <div className="mt-3 flex items-end gap-3">
          <div className="flex-1">
            <SliderField id="crop-hud-zoom" label="Zoom" display={`${activeCrop.zoom.toFixed(2)}×`} min={1} max={4} step={0.05} value={activeCrop.zoom} onChange={(zoom) => updateConfig(kind === 'avatar' ? 'avatarCrop' : 'imageCrop', { ...activeCrop, zoom })} />
          </div>
          <button type="button" className="btn btn-quiet" onClick={() => updateConfig(kind === 'avatar' ? 'avatarCrop' : 'imageCrop', { ...defaultCrop, zoom: 1.3 })}>Reset</button>
        </div>
      </PopoverContent>
    </Popover>
  );

  const surfacePicker = (
    <Section title="Desk surface" hint="Real pine, oak, walnut, maple or mahogany in the frame. Upload a photo if you want a different desk, or remove it.">
      <ToggleGroup type="single" value={config.surface} onValueChange={(value) => value && updateConfig('surface', value as StudioConfig['surface'])} className="grid grid-cols-2 gap-2" aria-label="Desk surface">
        {deskSurfaces.map((item) => (
          <ToggleGroupItem key={item.id} value={item.id} className="option-chip swatch-option h-11 justify-start rounded-[6px] px-3 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">
            {item.id === 'custom' ? (
              <span className="swatch" style={{ background: config.deskColor || item.swatch }} aria-hidden />
            ) : (
              <span className="swatch wood-swatch" style={{ backgroundImage: `url(${deskTextureUrls[item.id]})` }} aria-hidden />
            )}
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {config.surface === 'custom' && (
        <ColorField id="desk-color" label="Custom desk colour" value={config.deskColor || '#c08a4a'} onChange={(value) => updateConfig('deskColor', value)} />
      )}
      <div className="flex flex-wrap gap-2">
        <FileButton accept="image/*" onChange={(event) => uploadImage(event, 'desk')}><ImagePlus size={16} aria-hidden /> Custom background</FileButton>
        {config.deskImage && (
          <button type="button" className="btn btn-danger" onClick={() => clearUploadedImage('desk')}>
            <Trash2 size={16} aria-hidden /> Remove background
          </button>
        )}
      </div>
    </Section>
  );

  const applyPaperTexture = (src: string) => {
    setConfig((current) => ({ ...current, customImage: publicAssetUrl(src) }));
    toast.success('Paper photo is on the page');
  };

  const paperPhotoPicker = paperMode ? (
    <Section title="Paper background" hint="Put a linen, kraft or grid photo on the sheet, or upload your own. Remove takes it off again.">
      <div className="paper-texture-row">
        {paperTextures.map((item) => {
          const src = publicAssetUrl(item.src);
          const active = Boolean(config.customImage && (config.customImage === src || config.customImage.endsWith(item.src)));
          return (
            <button
              type="button"
              key={item.id}
              className={`paper-texture ${active ? 'is-active' : ''}`}
              onClick={() => applyPaperTexture(item.src)}
              aria-pressed={active}
            >
              <img src={src} alt="" width={72} height={96} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <FileButton accept="image/*" onChange={(event) => uploadImage(event, 'background')}>
          <ImagePlus size={16} aria-hidden /> Upload paper photo
        </FileButton>
        {config.customImage && (
          <button type="button" className="btn btn-danger" onClick={() => clearUploadedImage('background')}>
            <Trash2 size={16} aria-hidden /> Remove paper photo
          </button>
        )}
      </div>
      {config.customImage ? (
        <div className="paper-photo-card">
          <img src={publicAssetUrl(config.customImage)} alt="Paper background on the note" width={72} height={96} />
          <div>
            <strong>On the page now</strong>
            <p className="helper mt-1">This photo sits under the ink. Remove clears it.</p>
          </div>
        </div>
      ) : (
        <p className="helper">No paper photo yet — the sheet uses the colour above.</p>
      )}
    </Section>
  ) : null;

  const finishSelect = (
    <FieldRow label="Paper and ink finish">
      <RadioGroup value={config.finish} onValueChange={(value) => applyFinish(value as StudioConfig['finish'])} className="grid gap-2" aria-label="Finish">
        {noteFinishes.map((item) => {
          const id = `finish-${item.id}`;
          const checked = config.finish === item.id;
          return (
            <label key={item.id} htmlFor={id} className={`option-card flex-row items-start gap-3 ${checked ? 'is-checked' : ''}`}>
              <RadioGroupItem id={id} value={item.id} className="mt-0.5 h-5 w-5 flex-none border-input shadow-none" />
              <span className="flex flex-col gap-0.5"><strong>{item.label}</strong><small>{item.hint}</small></span>
            </label>
          );
        })}
      </RadioGroup>
    </FieldRow>
  );

  const paperKindPicker = paperMode ? (
    <Section title="Page" hint="A4 sheet. Notebook, white paper, or diary — same size, different ruling.">
      <ToggleGroup type="single" value={config.paperKind} onValueChange={(value) => value && applyPaperKind(value as PaperKind)} className="grid grid-cols-3 gap-2" aria-label="Paper kind">
        {paperKinds.map((item) => (
          <ToggleGroupItem key={item.id} value={item.id} title={item.hint} className="option-chip h-11 rounded-[6px] px-2 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{item.label}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="helper">{paperKinds.find((item) => item.id === config.paperKind)?.hint}</p>
    </Section>
  ) : null;

  const paperColorPicker = (
    <FieldRow label="Paper colour">
      <ToggleGroup type="single" value={config.paperColorPreset} onValueChange={(value) => value && applyPaperColor(value as PaperColorPreset)} className="grid grid-cols-2 gap-2" aria-label="Paper colour">
        {paperColorPresets.map((item) => (
          <ToggleGroupItem key={item.id} value={item.id} className="option-chip swatch-option h-10 justify-start rounded-[6px] px-3 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">
            <span className="swatch" style={{ background: item.id === 'custom' ? config.paperColor : item.hex }} aria-hidden />
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {(config.paperColorPreset === 'custom' || config.paperColorPreset === 'watercolour') && (
        <ColorField id="paper-color" label={config.paperColorPreset === 'watercolour' ? 'Wash base' : 'Custom paper colour'} value={config.paperColor} onChange={(value) => { updateConfig('paperColor', value); if (config.paperColorPreset !== 'watercolour') updateConfig('paperColorPreset', 'custom'); }} />
      )}
    </FieldRow>
  );

  const typographySliders = (
    <div className="grid grid-cols-3 gap-3">
      <SliderField id="line-spacing" label="Line height" display={config.lineSpacing.toFixed(2)} min={1} max={2} step={.05} value={config.lineSpacing} onChange={(value) => updateConfig('lineSpacing', value)} />
      <SliderField id="letter-spacing" label="Letter spacing" display={config.letterSpacing.toFixed(1)} min={-1} max={4} step={.1} value={config.letterSpacing} onChange={(value) => updateConfig('letterSpacing', value)} />
      <SliderField id="note-y" label="Top position" display={`${Math.round(config.noteY * 100)}%`} min={.04} max={.4} step={.01} value={config.noteY} onChange={(value) => updateConfig('noteY', value)} />
    </div>
  );

  const copyTab = (
    <div>
      {avatarMode && (
        <Section title="Avatar photo" hint="Add a photo for this row, paste a direct image link, or import a list with an image column. Imported portraits are copied here so a dead link will not wipe them.">
          <label
            className="upload-zone is-compact"
            onDragOver={(event) => event.preventDefault()}
            onDrop={async (event) => {
              event.preventDefault();
              const file = event.dataTransfer.files[0];
              if (!file) return;
              try {
                await addAvatarFile(file);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Could not add that photo.');
              }
            }}
          >
            <ImagePlus size={24} aria-hidden />
            <strong>Drop a portrait or browse</strong>
            <span>PNG, JPG, WEBP, GIF or SVG · up to 10 MB</span>
            <input type="file" className="sr-only" accept="image/*" onChange={(event) => uploadImage(event, 'avatar')} />
          </label>
          {avatarSource && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-surface-2 p-3">
              <DurablePortrait src={avatarSource} className="h-12 w-12 rounded-full object-cover" size={48} />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold">{contactName(contact)}</strong>
                <small className="block truncate text-xs text-muted-foreground">{config.avatarColumn ? `On this row · {${config.avatarColumn}}` : config.avatarUrl ? 'From link' : 'Uploaded photo'}</small>
              </div>
              <button type="button" className="btn btn-quiet btn-sm" onClick={clearRowAvatar}>Clear</button>
            </div>
          )}
          <FieldRow id="avatar-url" label="Portrait link">
            <div className="flex gap-2">
              <input
                id="avatar-url"
                className="field"
                placeholder="https://…/headshot.jpg"
                value={config.avatarUrl ?? ''}
                onChange={(event) => updateConfig('avatarUrl', event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void applyAvatarLink();
                  }
                }}
              />
              <button type="button" className="btn btn-quiet flex-none" onClick={() => void applyAvatarLink()}><Link2 size={16} aria-hidden /> Use link</button>
            </div>
          </FieldRow>
          <div className="grid grid-cols-2 gap-3">
            <FieldRow id="avatar-column" label="Portrait column">
              <select id="avatar-column" className="field" value={config.avatarColumn ?? ''} onChange={(event) => updateConfig('avatarColumn', event.target.value)}>
                <option value="">None</option>
                {columns.map((column) => <option key={column}>{column}</option>)}
              </select>
            </FieldRow>
            <FieldRow id="message-column" label="Message column">
              <select id="message-column" className="field" value={config.messageColumn ?? ''} onChange={(event) => updateConfig('messageColumn', event.target.value)}>
                <option value="">None</option>
                {columns.map((column) => <option key={column}>{column}</option>)}
              </select>
            </FieldRow>
          </div>
          <FieldRow id="row-message" label="Message this row can add">
            <textarea id="row-message" className="field" rows={3} value={config.message} onChange={(event) => updateConfig('message', event.target.value)} placeholder="{msg|Loved what you shipped.}" />
            {previewMessage && <p className="mt-2 rounded-md bg-surface-2 p-3 text-sm leading-relaxed">{previewMessage}</p>}
          </FieldRow>
          <label className="toggle-row">
            <Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={config.showMessage} onCheckedChange={(value) => updateConfig('showMessage', value === true)} />
            Include the list message on the letter
          </label>
        </Section>
      )}
      {paperMode ? (
        <Section title={avatarMode ? 'Letter copy' : 'Note copy'}>
          <FieldRow id="note-copy" label={<span className="flex items-center justify-between gap-2">Message <span className="mono text-xs font-normal text-muted-foreground">{config.copy.length} chars · {copyLines} lines</span></span>}>
            <textarea id="note-copy" className="field leading-relaxed" rows={8} value={config.copy} onChange={(event) => updateConfig('copy', event.target.value)} />
          </FieldRow>
          <div className="rounded-md bg-surface-2 p-3 text-sm leading-relaxed whitespace-pre-wrap">{renderMerge(config.copy, contact)}</div>
          <FieldRow id="signature" label={avatarMode ? 'Typed signature' : 'Signature'}>
            <input id="signature" className="field" value={config.signature} onChange={(event) => updateConfig('signature', event.target.value)} />
          </FieldRow>
          {handwritingMode && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-quiet" onClick={() => setSignOpen(true)}><PenLine size={16} aria-hidden /> Draw sign</button>
              <FileButton accept="image/png,image/webp" onChange={(event) => uploadImage(event, 'signature')}><Upload size={16} aria-hidden /> Sign file</FileButton>
            </div>
          )}
          <FieldRow id="postscript" label="Postscript">
            <input id="postscript" className="field" value={config.postscript} onChange={(event) => updateConfig('postscript', event.target.value)} placeholder="P.S. {company} caught my attention." />
          </FieldRow>
          <p className="helper">{mode === 'handgif' ? 'A photographed hand writes this note. Download and Generate are GIFs.' : avatarMode ? ((config.textMotion ?? 'still') === 'still' ? 'Still portrait card. Download is a PNG. Choose Auto writing if you want the letter to type in.' : 'Portrait stays. The letter animates. Download is a GIF.') : 'This studio exports a still page. Use Handwriting GIF if you want the writing hand.'}</p>
        </Section>
      ) : (
        <Section title="Text layers" hint="Each layer is a movable block on the image. Drag it on the stage or use the Look tab.">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" value={activeLayerId} onValueChange={(value) => value && setActiveLayerId(value)} className="flex-wrap justify-start gap-2" aria-label="Text layer">
              {config.layers.map((layer) => (
                <ToggleGroupItem key={layer.id} value={layer.id} className="option-chip h-10 rounded-[6px] px-3 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{layer.name}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <button type="button" onClick={addLayer} className="btn btn-quiet"><Plus size={16} aria-hidden /> Add layer</button>
          </div>
          {activeLayer && (
            <>
              <FieldRow id="layer-copy" label={`${activeLayer.name} text`}>
                <textarea id="layer-copy" className="field" rows={4} value={activeLayer.text} onChange={(event) => updateLayer({ text: event.target.value })} />
                <p className="mt-2 rounded-md bg-surface-2 p-3 text-sm leading-relaxed">{renderMerge(activeLayer.text, contact)}</p>
              </FieldRow>
              <FieldRow id="layer-highlight" label="Highlight words" hint="Optional. Comma-separated words get a marker, like Canva.">
                <input
                  id="layer-highlight"
                  className="field"
                  value={activeLayer.highlight ?? ''}
                  placeholder="first_name, company"
                  onChange={(event) => updateLayer({ highlight: event.target.value })}
                />
              </FieldRow>
              <FieldRow label="Text motion">
                <ToggleGroup type="single" value={activeLayer.animation ?? 'still'} onValueChange={(value) => value && updateLayer({ animation: value as TextAnim })} className="grid grid-cols-3 gap-2" aria-label={`${activeLayer.name} text motion`}>
                  {textAnims.map((anim) => (
                    <ToggleGroupItem key={anim.id} value={anim.id} title={anim.hint} className="option-chip h-10 rounded-[6px] px-2 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{anim.label}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldRow>
            </>
          )}
        </Section>
      )}
      <Section title="Merge tags for this row">
        <div className="flex items-center gap-1">
          <p className="helper">Click a tag to insert it at the end of the copy.</p>
          <InfoTip label="How fallbacks and variations work">Fallback: {'{first_name|there}'} uses “there” when the cell is empty. Variation: {'{Hi|Hey|Hello}'} rotates per row.</InfoTip>
        </div>
        <div className="flex flex-wrap gap-2">
          {['row', ...(config.fieldMap?.length
            ? config.fieldMap.filter((item) => item.use !== 'ignore').map((item) => item.use === 'custom' ? (item.customTag || item.column) : item.column)
            : columns)].map((column) => (
            <button type="button" key={`copy-${column}`} onClick={() => insertTag(`{${column}}`)} className="tag-chip">
              {'{'}{column}{'}'}
            </button>
          ))}
        </div>
        {invalid.length > 0 && (
          <p className="inline-flex items-start gap-2 text-sm text-warning"><CircleAlert size={16} className="mt-0.5 flex-none" aria-hidden /> Unknown in this row: {invalid.join(', ')}. Check the column names or add a fallback.</p>
        )}
      </Section>
    </div>
  );

  const lookTab = (
    <div>
      <Section title="Template and size">
        <div className="grid grid-cols-2 gap-3">
          {!paperMode && (
            <FieldRow id="template" label="Template">
              <select id="template" className="field" value={config.template} onChange={(event) => updateConfig('template', event.target.value)}>
                {templateOptions[mode].map((template) => <option key={template}>{template}</option>)}
              </select>
            </FieldRow>
          )}
          <FieldRow id="channel" label={paperMode ? 'Page size' : 'Canvas size'}>
            <select
              id="channel"
              className="field"
              value={config.channel}
              onChange={(event) => {
                const channel = event.target.value as CanvasSize;
                if (mode === 'avatar') {
                  const layout = avatarInNoteLayout(channel, config.avatarZone.width, config.noteZone);
                  setConfig((current) => ({ ...current, channel, noteZone: layout.note, avatarZone: layout.avatar, textZone: layout.text }));
                } else {
                  updateConfig('channel', channel);
                }
              }}
            >
              {(Object.keys(canvasSizes) as CanvasSize[]).map((size) => (
                <option key={size} value={size}>{canvasSizes[size].label}</option>
              ))}
            </select>
          </FieldRow>
        </div>
      </Section>
      {paperKindPicker}
      {avatarMode && (
        <Section title="Portrait">
          <SliderField
            id="avatar-size"
            label="Avatar size"
            display={`${Math.round(config.avatarZone.width * 100)}%`}
            min={16}
            max={36}
            value={Math.round(config.avatarZone.width * 100)}
            onChange={(value) => {
              const layout = avatarInNoteLayout(config.channel, value / 100, config.noteZone);
              setConfig((current) => ({ ...current, avatarZone: layout.avatar, textZone: layout.text }));
            }}
          />
          <FieldRow label="Avatar shape">
            <ToggleGroup type="single" value={config.avatarShape ?? 'circle'} onValueChange={(value) => value && updateConfig('avatarShape', value as AvatarShape)} className="grid grid-cols-3 gap-2" aria-label="Avatar shape">
              {(['circle', 'rounded', 'square'] as AvatarShape[]).map((shape) => (
                <ToggleGroupItem key={shape} value={shape} className="option-chip h-10 rounded-[6px] px-3 text-sm font-semibold capitalize hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{shape}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldRow>
        </Section>
      )}
      {avatarMode && <CropSliders label="Crop avatar" crop={config.avatarCrop ?? defaultCrop} onChange={(crop) => updateConfig('avatarCrop', crop)} />}
      <CropSliders label={cutMode ? 'Crop background' : 'Crop paper photo'} crop={config.imageCrop ?? defaultCrop} onChange={(crop) => updateConfig('imageCrop', crop)} />
      {handwritingMode ? (
        <>
          <Section title="Handwriting">
            <FieldRow label="What kind of handwritten">
              <RadioGroup value={config.handwritingKind} onValueChange={(value) => updateConfig('handwritingKind', value as StudioConfig['handwritingKind'])} className="grid gap-2" aria-label="Handwriting kind">
                {handwritingKinds.map((kind) => {
                  const id = `kind-${kind.id}`;
                  const checked = config.handwritingKind === kind.id;
                  return (
                    <label key={kind.id} htmlFor={id} className={`option-card flex-row items-start gap-3 ${checked ? 'is-checked' : ''}`}>
                      <RadioGroupItem id={id} value={kind.id} className="mt-0.5 h-5 w-5 flex-none border-input shadow-none" />
                      <span className="flex flex-col gap-0.5"><strong>{kind.label}</strong><small>{kind.hint}</small></span>
                    </label>
                  );
                })}
              </RadioGroup>
            </FieldRow>
            <FieldRow id="handwriting-style" label="Writing style" hint="Handwriting 1 to 7. The note uses the one you pick.">
              <div id="handwriting-style" className="writing-style-grid" role="listbox" aria-label="Writing style">
                {noteWritingStyles.map((style) => {
                  const active = config.fontFamily === style.font && !config.customFontDataUrl;
                  return (
                    <button
                      type="button"
                      key={style.id}
                      role="option"
                      aria-selected={active}
                      className={`writing-style ${active ? 'is-active' : ''}`}
                      onClick={() => setConfig((current) => ({ ...current, fontFamily: style.font, customFontDataUrl: undefined }))}
                    >
                      <span className="writing-style-sample" style={{ fontFamily: `"${style.font}", cursive`, fontSize: style.size }}>{style.sample}</span>
                      <span className="writing-style-name">{style.label}</span>
                    </button>
                  );
                })}
              </div>
            </FieldRow>
            <div className="rounded-md border border-border bg-surface-2 p-4">
              <SliderField id="realism" label="Realism" display={`${config.realism}%`} min={0} max={100} value={config.realism} onChange={(value) => updateConfig('realism', value)} />
              <div className="flex justify-between text-xs font-semibold uppercase tracking-[.06em] text-muted-foreground"><span>Light</span><span>Strong</span></div>
              <p className="helper mt-2">{handwritingKinds.find((item) => item.id === config.handwritingKind)?.hint}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="toggle-row"><Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={config.ruledLines} onCheckedChange={(value) => updateConfig('ruledLines', value === true)} /> Ruled lines</label>
              <label className="toggle-row"><Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={config.showMargin} onCheckedChange={(value) => updateConfig('showMargin', value === true)} /> Margin</label>
              <label className="toggle-row"><Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={config.shuffleHandwriting} onCheckedChange={(value) => updateConfig('shuffleHandwriting', value === true)} /> Shuffle handwriting</label>
              <label className="toggle-row"><Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={config.shuffleFinish} onCheckedChange={(value) => updateConfig('shuffleFinish', value === true)} /> Shuffle picture styles</label>
            </div>
            <button type="button" className="btn btn-quiet w-full" onClick={() => updateConfig('seed', Math.floor(Math.random() * 9999))}>
              <Shuffle size={16} aria-hidden /> Reshuffle this row
            </button>
          </Section>
          <Section title="Paper and ink">
            {finishSelect}
            {config.finish === 'desk' && surfacePicker}
            <div className="grid grid-cols-2 gap-3">
              <SliderField id="font-size" label="Font size" display={`${config.fontSize}px`} min={18} max={72} value={config.fontSize} onChange={(value) => updateConfig('fontSize', value)} />
              <ColorField id="ink-color" label="Ink" value={config.inkColor} onChange={(value) => updateConfig('inkColor', value)} />
            </div>
            {paperColorPicker}
            {paperPhotoPicker}
            <div className="grid grid-cols-2 gap-2">
              <FileButton accept=".ttf,.otf,.woff,.woff2" onChange={uploadFont}><PenTool size={16} aria-hidden /> Font</FileButton>
              <FileButton accept="image/png,image/webp" onChange={(event) => uploadImage(event, 'signature')}><Upload size={16} aria-hidden /> Sign file</FileButton>
              <button type="button" className="btn btn-quiet" onClick={() => setSignOpen(true)}><PenLine size={16} aria-hidden /> Draw sign</button>
              {config.signatureImage && (
                <button type="button" className="btn btn-danger" onClick={() => clearUploadedImage('signature')}><Trash2 size={16} aria-hidden /> Remove signature</button>
              )}
            </div>
            {typographySliders}
          </Section>
          {mode === 'handgif' && (
            <Section title="Writing GIF" hint="Pick a photographed hand. The nib stays on the letter as it writes. Download is always a GIF.">
              <div className="hand-picker" role="listbox" aria-label="Writing hand">
                {writingHands.map((hand) => {
                  const src = publicAssetUrl(hand.src);
                  const active = (config.writingHand ?? 'liner') === hand.id;
                  return (
                    <button
                      type="button"
                      key={hand.id}
                      role="option"
                      aria-selected={active}
                      className={`hand-option ${active ? 'is-active' : ''}`}
                      onClick={() => updateConfig('writingHand', hand.id as WritingHandId)}
                    >
                      <img src={src} alt="" width={96} height={72} />
                      <span>{hand.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="helper">{writingHands.find((item) => item.id === (config.writingHand ?? 'liner'))?.hint}</p>
              <FieldRow label="Writing speed" hint={writingSpeedSpec(config.writingSpeed).hint}>
                <ToggleGroup type="single" value={config.writingSpeed ?? 'medium'} onValueChange={(value) => value && updateConfig('writingSpeed', value as WritingSpeed)} className="grid grid-cols-3 gap-2" aria-label="Writing speed">
                  {writingSpeeds.map((speed) => (
                    <ToggleGroupItem key={speed.id} value={speed.id} title={speed.hint} className="option-chip h-10 rounded-[6px] px-2 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{speed.label}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldRow>
              <div className="grid grid-cols-3 gap-2">
                <FieldRow id="handgif-fps" label="Frame rate">
                  <select id="handgif-fps" className="field" value={config.gifFps} onChange={(event) => updateConfig('gifFps', Number(event.target.value))}><option value="8">8 fps</option><option value="10">10 fps</option><option value="12">12 fps</option></select>
                </FieldRow>
                <FieldRow id="handgif-loop" label="Loop">
                  <select id="handgif-loop" className="field" value={config.gifLoop} onChange={(event) => updateConfig('gifLoop', Number(event.target.value))}><option value="0">Forever</option><option value="1">Once</option><option value="3">3 times</option></select>
                </FieldRow>
                <FieldRow id="handgif-quality" label="Quality">
                  <select id="handgif-quality" className="field" value={config.gifQuality} onChange={(event) => updateConfig('gifQuality', Number(event.target.value))}><option value="3">Small</option><option value="7">Balanced</option><option value="10">High</option></select>
                </FieldRow>
              </div>
            </Section>
          )}
        </>
      ) : avatarMode ? (
        <Section title="Letter and paper">
          <FieldRow id="typed-font" label="Typeface" hint="The portrait sits on the paper. Drag the Text frame to place the letter — it is typed, not handwritten.">
            <select id="typed-font" className="field" value={config.fontFamily} onChange={(event) => updateConfig('fontFamily', event.target.value)}>
              {typedFonts.map((font) => <option key={font} value={font}>{font}</option>)}
            </select>
          </FieldRow>
          {finishSelect}
          {config.finish === 'desk' && surfacePicker}
          <div className="grid grid-cols-2 gap-3">
            <SliderField id="font-size" label="Type size" display={`${config.fontSize}px`} min={16} max={48} value={config.fontSize} onChange={(value) => updateConfig('fontSize', value)} />
            <ColorField id="ink-color" label="Ink" value={config.inkColor} onChange={(value) => updateConfig('inkColor', value)} />
          </div>
          {paperColorPicker}
          {paperPhotoPicker}
          {typographySliders}
          <FieldRow label="Letter motion" hint={(config.textMotion ?? 'still') === 'still' ? 'Still letter. Download is a PNG.' : 'Portrait stays. The letter animates. Download is a GIF.'}>
            <ToggleGroup type="single" value={config.textMotion ?? 'type'} onValueChange={(value) => value && updateConfig('textMotion', value as TextMotion)} className="grid grid-cols-2 gap-2" aria-label="Avatar letter motion">
              {textMotions.map((motion) => (
                <ToggleGroupItem key={motion.id} value={motion.id} title={motion.hint} className="option-chip h-10 rounded-[6px] px-2 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{motion.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldRow>
          <FieldRow
            id="avatar-highlight"
            label="Highlight words"
            hint="Words from the letter, or a column name like company or first_name. Empty + Highlight marks every line."
          >
            <input
              id="avatar-highlight"
              className="field"
              value={config.layers[0]?.highlight ?? ''}
              placeholder="first_name, company, Darwin"
              onChange={(event) => {
                const next = config.layers[0] ? [{ ...config.layers[0], highlight: event.target.value }, ...config.layers.slice(1)] : defaultLayers;
                setConfig((current) => ({ ...current, layers: next }));
              }}
            />
          </FieldRow>
          <ColorField
            id="avatar-highlight-color"
            label="Highlight colour"
            value={config.layers[0]?.highlightColor || '#ffe566'}
            onChange={(value) => {
              const next = config.layers[0] ? [{ ...config.layers[0], highlightColor: value }, ...config.layers.slice(1)] : defaultLayers;
              setConfig((current) => ({ ...current, layers: next }));
            }}
          />
          {(config.textMotion ?? 'still') !== 'still' && (
            <Section title="Letter GIF" hint="Portrait stays on the page. The letter animates, then the last frames hold.">
              <div className="grid grid-cols-3 gap-2">
                <FieldRow id="avatar-fps" label="Frame rate">
                  <select id="avatar-fps" className="field" value={config.gifFps} onChange={(event) => updateConfig('gifFps', Number(event.target.value))}><option value="8">8 fps</option><option value="10">10 fps</option><option value="12">12 fps</option></select>
                </FieldRow>
                <FieldRow id="avatar-loop" label="Loop">
                  <select id="avatar-loop" className="field" value={config.gifLoop} onChange={(event) => updateConfig('gifLoop', Number(event.target.value))}><option value="0">Forever</option><option value="1">Once</option><option value="3">3 times</option></select>
                </FieldRow>
                <FieldRow id="avatar-quality" label="Quality">
                  <select id="avatar-quality" className="field" value={config.gifQuality} onChange={(event) => updateConfig('gifQuality', Number(event.target.value))}><option value="3">Small</option><option value="7">Balanced</option><option value="10">High</option></select>
                </FieldRow>
              </div>
            </Section>
          )}
          <div className="grid grid-cols-2 gap-2">
            <FileButton accept=".ttf,.otf,.woff,.woff2" onChange={uploadFont}><PenTool size={16} aria-hidden /> Custom font</FileButton>
          </div>
        </Section>
      ) : (
        <>
          <Section title="Motion" hint={usesMotion(config) ? `${memeMotions.find((item) => item.id === config.animation)?.hint ?? 'Animated'}. Download this row or Generate exports a GIF.` : 'Still frame — exports a PNG.'}>
            <ToggleGroup type="single" value={config.animation} onValueChange={(value) => value && updateConfig('animation', value as StudioConfig['animation'])} className="grid grid-cols-3 gap-2" aria-label="Meme motion">
              {memeMotions.map((motion) => (
                <ToggleGroupItem key={motion.id} value={motion.id} title={motion.hint} className="option-chip h-10 rounded-[6px] px-2 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{motion.label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Section>
          {activeLayer && (
            <Section title={`${activeLayer.name} layer`}>
              <div className="grid grid-cols-2 gap-3">
                <SliderField id="layer-size" label="Size" display={`${activeLayer.fontSize}px`} min={20} max={120} value={activeLayer.fontSize} onChange={(value) => updateLayer({ fontSize: value })} />
                <ColorField id="layer-color" label="Fill" value={activeLayer.color} onChange={(value) => updateLayer({ color: value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SliderField id="layer-x" label="Left" display={`${Math.round(activeLayer.x * 100)}%`} min={0} max={80} value={Math.round(activeLayer.x * 100)} onChange={(value) => updateLayer({ x: value / 100 })} />
                <SliderField id="layer-y" label="Top" display={`${Math.round(activeLayer.y * 100)}%`} min={0} max={88} value={Math.round(activeLayer.y * 100)} onChange={(value) => updateLayer({ y: value / 100 })} />
              </div>
              <ColorField id="layer-mark" label="Highlight colour" value={activeLayer.highlightColor || '#ffe566'} onChange={(value) => updateLayer({ highlightColor: value })} />
              <FieldRow label="Align">
                <ToggleGroup type="single" value={activeLayer.align} onValueChange={(value) => value && updateLayer({ align: value as TextLayer['align'] })} className="grid grid-cols-3 gap-2" aria-label={`${activeLayer.name} alignment`}>
                  {(['left', 'center', 'right'] as const).map((align) => (
                    <ToggleGroupItem key={align} value={align} className="option-chip h-10 rounded-[6px] px-3 text-sm font-semibold capitalize hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{align}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldRow>
              <label className="toggle-row">
                <Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={activeLayer.outline} onCheckedChange={(value) => updateLayer({ outline: value === true })} />
                Outline
              </label>
              <label className="toggle-row">
                <Checkbox className="h-5 w-5 rounded-[4px] border-input" checked={Boolean(activeLayer.boxFill)} onCheckedChange={(value) => updateLayer({ boxFill: value === true ? '#111111' : '' })} />
                Box behind text
              </label>
              {activeLayer.boxFill ? (
                <ColorField id="layer-box" label="Box fill" value={activeLayer.boxFill} onChange={(value) => updateLayer({ boxFill: value })} />
              ) : null}
              <FieldRow label="Text motion">
                <ToggleGroup type="single" value={activeLayer.animation ?? 'still'} onValueChange={(value) => value && updateLayer({ animation: value as TextAnim })} className="grid grid-cols-3 gap-2" aria-label={`${activeLayer.name} animation`}>
                  {textAnims.map((anim) => (
                    <ToggleGroupItem key={anim.id} value={anim.id} title={anim.hint} className="option-chip h-10 rounded-[6px] px-2 text-sm font-semibold hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-primary">{anim.label}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </FieldRow>
              <button type="button" className="btn btn-danger self-start" onClick={removeLayer} disabled={config.layers.length <= 1} title={config.layers.length <= 1 ? 'Keep at least one layer' : undefined}><Trash2 size={16} aria-hidden /> Remove layer</button>
            </Section>
          )}
          <Section title="Data on the image">
            <FieldRow id="website-column" label="Website image column">
              <select id="website-column" className="field" value={config.websiteColumn ?? ''} onChange={(event) => updateConfig('websiteColumn', event.target.value)}>
                <option value="">None</option>
                {columns.map((column) => <option key={column}>{column}</option>)}
              </select>
            </FieldRow>
          </Section>
          {(mode === 'gif' || (config.layers ?? []).some((layer) => (layer.animation ?? 'still') !== 'still')) && (
            <Section title="GIF encoding">
              <div className="grid grid-cols-3 gap-2">
                <FieldRow id="gif-fps" label="Frame rate">
                  <select id="gif-fps" className="field" value={config.gifFps} onChange={(event) => updateConfig('gifFps', Number(event.target.value))}><option value="8">8 fps</option><option value="12">12 fps</option><option value="18">18 fps</option></select>
                </FieldRow>
                <FieldRow id="gif-loop" label="Loop">
                  <select id="gif-loop" className="field" value={config.gifLoop} onChange={(event) => updateConfig('gifLoop', Number(event.target.value))}><option value="0">Forever</option><option value="1">Once</option><option value="3">3 times</option></select>
                </FieldRow>
                <FieldRow id="gif-quality" label="Quality">
                  <select id="gif-quality" className="field" value={config.gifQuality} onChange={(event) => updateConfig('gifQuality', Number(event.target.value))}><option value="3">Small</option><option value="7">Balanced</option><option value="10">High</option></select>
                </FieldRow>
              </div>
              <p className="mono text-sm text-muted-foreground">Estimate: {gifEstimateKb} KB · {config.gifFrames?.length ?? 12} frames</p>
            </Section>
          )}
        </>
      )}
    </div>
  );

  const shipTab = (
    <div>
      <Section title="File names">
        <FieldRow id="filename" label="Naming pattern">
          <input id="filename" className="field" value={config.filename} onChange={(event) => updateConfig('filename', event.target.value)} />
          <p className="mono mt-2 truncate text-sm text-muted-foreground" title={previewFilename}>{previewFilename}</p>
        </FieldRow>
      </Section>
      <Section title="Generate">
        {generating ? (
          <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <Progress value={progress} aria-label="Batch progress" className="h-2 bg-surface-2 [&>div]:bg-primary [&>div]:transition-transform [&>div]:duration-[220ms]" />
            <p className="mono text-sm">{progress}% · {progressDone} of {progressTotal}{etaSeconds !== null ? ` · ~${etaSeconds} s left` : ''}</p>
            <button type="button" className="btn btn-quiet w-full" onClick={generateBatch}><Pause size={16} aria-hidden /> Cancel and keep completed</button>
          </div>
        ) : (
          <button type="button" onClick={generateBatch} className="btn btn-primary btn-lg w-full" disabled={!contacts.length} title={!contacts.length ? 'Import a list first' : undefined}>
            <Wand2 size={16} aria-hidden /> Generate {batchSize} {batchSize === 1 ? 'asset' : 'assets'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-quiet w-full"
          onClick={() => void openBatchReview()}
          disabled={!contacts.length || generating}
          title={!contacts.length ? 'Import a list first' : undefined}
        >
          <Images size={16} aria-hidden /> Review all images{assets.length ? ` (${assets.length})` : ''}
        </button>
        <p className="helper">Opens every image stored in Supabase for this studio. Generate first if the cloud list is still empty.</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-quiet" onClick={downloadThisRow} disabled={downloading || generating} data-loading={downloading || undefined} aria-busy={downloading || undefined}><Download size={16} aria-hidden /> This row</button>
          <button type="button" className="btn btn-quiet" onClick={downloadAll} disabled={generating}><FileArchive size={16} aria-hidden /> All as ZIP</button>
        </div>
        <button type="button" className="btn btn-quiet w-full" onClick={downloadListCsv} disabled={!contacts.length}>
          <Download size={16} aria-hidden /> Download list CSV
        </button>
        {assets.length > 0 && (
          <button type="button" className="btn btn-quiet w-full" onClick={downloadZip}><FileArchive size={16} aria-hidden /> ZIP selected ({assets.filter((asset) => asset.selected && asset.status !== 'failed').length})</button>
        )}
        <p className="helper">
          Generate writes {outputColumnNames(mode).slice(0, 2).map((column) => `{${column}}`).join(' and ')} onto every row of the imported spreadsheet, uploads the files to Supabase, and includes that updated CSV in the ZIP.
        </p>
      </Section>
      <Section title="Saved templates" hint="Each studio keeps its own library in Supabase. Edit a row there and it appears here on the next refresh.">
        {templatesForMode.length ? templatesForMode.map((item) => (
          <div key={item.id} className="flex items-center gap-2">
            <button type="button" onClick={() => loadTemplate(item)} className="template-row min-w-0 flex-1">
              <span className="min-w-0">
                <span className="block truncate">{item.name}</span>
                <small className="block text-xs font-normal text-muted-foreground">{item.cloud ? 'Supabase' : 'This browser'} · {new Date(item.updatedAt).toLocaleString()}</small>
              </span>
              <ArrowRight size={16} aria-hidden />
            </button>
            <button type="button" className="btn btn-quiet btn-icon" aria-label={`Copy ${item.name}`} onClick={() => void duplicateTemplate(item)}>
              <Copy size={16} aria-hidden />
            </button>
          </div>
        )) : (
          <p className="helper">Save this configuration with “Save template” to keep a reusable look for {modeLabel(mode)} only.</p>
        )}
      </Section>
    </div>
  );

  const inspector = (
    <Tabs value={deskTab} onValueChange={(value) => setDeskTab(value as DeskTab)} className="flex min-h-0 flex-1 flex-col">
      <TabsList className="inspector-tabs grid h-11 w-full grid-cols-3 rounded-none bg-transparent p-0 px-5 text-muted-foreground" aria-label="Studio controls">
        <TabsPrimitive.Trigger value="copy" className="inspector-tab h-11 rounded-none px-0 text-sm font-semibold data-[state=active]:bg-transparent data-[state=active]:text-primary"><Type size={16} aria-hidden /> Copy</TabsPrimitive.Trigger>
        <TabsPrimitive.Trigger value="look" className="inspector-tab h-11 rounded-none px-0 text-sm font-semibold data-[state=active]:bg-transparent data-[state=active]:text-primary"><Palette size={16} aria-hidden /> Look</TabsPrimitive.Trigger>
        <TabsPrimitive.Trigger value="ship" className="inspector-tab h-11 rounded-none px-0 text-sm font-semibold data-[state=active]:bg-transparent data-[state=active]:text-primary"><Send size={16} aria-hidden /> Ship</TabsPrimitive.Trigger>
      </TabsList>
      <div className="ink-well-scroll min-h-0 flex-1">
        <TabsContent value="copy" className="mt-0">{copyTab}</TabsContent>
        <TabsContent value="look" className="mt-0">{lookTab}</TabsContent>
        <TabsContent value="ship" className="mt-0">{shipTab}</TabsContent>
      </div>
    </Tabs>
  );

  return (
    <div className="studio-floor animate-rise">
      <p className="sr-live" aria-live="polite" role="status">{announcement}</p>
      {error && (
        <Alert variant="destructive" className="border-destructive/40 bg-destructive/5 pr-14 text-foreground [&>svg]:text-destructive">
          <CircleAlert size={16} aria-hidden />
          <AlertTitle>Something needs your attention</AlertTitle>
          <AlertDescription className="text-base">{explainError(error)}</AlertDescription>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss" className="btn btn-ghost btn-icon absolute right-2 top-2 h-11 w-11"><X size={18} aria-hidden /></button>
        </Alert>
      )}

      <header className="studio-toolbar">
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{mode === 'avatar' ? 'Portrait desk' : handwritingMode ? (mode === 'handgif' ? 'Writing desk' : 'Paper desk') : 'Cutting room'}</p>
          <h1 className="flex items-center gap-2">
            <input
              className="campaign-title"
              aria-label="Campaign name"
              value={config.campaignName}
              onChange={(event) => updateConfig('campaignName', event.target.value)}
            />
            <PenLine size={16} className="flex-none text-muted-foreground" aria-hidden />
          </h1>
        </div>
        <div className="toolbar-actions flex flex-wrap gap-2">
          <button type="button" className="btn btn-quiet" onClick={() => openList('source')}>
            <FolderOpen size={16} aria-hidden /> Import list
          </button>
          <button type="button" className="btn btn-quiet" onClick={saveTemplate} data-loading={savingTemplate || undefined} aria-busy={savingTemplate || undefined}><Sparkles size={16} aria-hidden /> Save template</button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void duplicateTemplate({
              id: config.templateId || crypto.randomUUID(),
              name: config.campaignName,
              mode,
              config,
              updatedAt: new Date().toISOString(),
              cloud: false,
            })}
          >
            <Copy size={16} aria-hidden /> Copy template
          </button>
          <button type="button" className="btn btn-quiet" onClick={saveCurrentCampaign} data-loading={saving || undefined} aria-busy={saving || undefined}><Save size={16} aria-hidden /> Save</button>
          <button type="button" className="btn btn-ghost btn-icon hidden lg:inline-flex" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard size={18} aria-hidden /></button>
        </div>
      </header>

      <ContactFilmstrip
        contacts={contacts}
        selectedRow={selectedRow}
        onSelect={setSelectedRow}
        portraitFor={(row) => resolveAvatarSource(config, row)}
        onOpenList={() => openList(contacts.length ? 'review' : 'source')}
      />

      <ImportDialog
        open={listOpen}
        onOpenChange={setListOpen}
        initialStep={listStep}
        currentMode={mode}
        currentContacts={contacts}
        savedMap={config.fieldMap as FieldAssignment[] | undefined}
        copyForTags={cutMode ? config.layers.map((layer) => layer.text).join(' ') : `${config.copy}\n${config.message}`}
        onImport={onImportResult}
        onInsertTag={insertTag}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <SignaturePad open={signOpen} onOpenChange={setSignOpen} onSave={(dataUrl) => void applyDrawnSignature(dataUrl)} />

      <div className="studio-grid">
        <main className="flex min-w-0 flex-col gap-4">
          <div className="stage-meta">
            <div className="flex flex-wrap items-center gap-2">
              {liveMotion && (
                <span className="status-badge is-neutral h-8 px-3 text-sm capitalize"><Play size={12} aria-hidden /> {liveLabel} live</span>
              )}
              {liveMotion && (
                <button type="button" className="btn btn-quiet btn-sm" aria-pressed={stagePaused} onClick={() => setStagePaused((value) => !value)}>
                  {stagePaused ? <><Play size={16} aria-hidden /> Play</> : <><Pause size={16} aria-hidden /> Pause</>}
                </button>
              )}
              {previewing && !slowPreview && <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status"><LoaderCircle size={16} className="animate-spin" aria-hidden /> Rendering…</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mode === 'memes' && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    addLayer();
                    setDeskTab('copy');
                    setInspectorOpen(true);
                  }}
                >
                  <Plus size={16} aria-hidden /> Add text
                </button>
              )}
              {mode === 'memes' && (config.customImage || config.gifSourceDataUrl) && (
                <button type="button" className="btn btn-danger" onClick={removeCurrentMeme}>
                  <Trash2 size={16} aria-hidden /> Remove meme
                </button>
              )}
              {cropPopover('image', (
                <button type="button" className="btn btn-quiet" aria-pressed={cropMode === 'image'} onClick={() => toggleCrop('image')}>
                  <Crop size={16} aria-hidden /> Crop {cutMode ? 'photo' : 'paper'}
                </button>
              ))}
              {avatarMode && cropPopover('avatar', (
                <button type="button" className="btn btn-quiet" aria-pressed={cropMode === 'avatar'} onClick={() => toggleCrop('avatar')}>
                  <Crop size={16} aria-hidden /> Crop avatar
                </button>
              ))}
              <span className="mono text-sm text-muted-foreground">{canvasDims.width} × {canvasDims.height}</span>
            </div>
          </div>
          <div className={`preview-stage ${landscape ? 'is-email' : ''} ${paperMode ? 'is-desk' : 'is-cut'} ${cropMode !== 'off' ? 'is-cropping' : ''} ${stagePaused ? 'stage-paused' : ''}`}>
            <div
              className="canvas-surface"
              style={{ aspectRatio: `${canvasDims.width} / ${canvasDims.height}` }}
              onPointerDown={beginCropDrag}
              onPointerMove={moveZone}
              onPointerUp={() => { dragRef.current = null; }}
              onPointerCancel={() => { dragRef.current = null; }}
            >
              <canvas ref={previewCanvas} className="h-full w-full" aria-label={`Preview of ${previewFilename}`} role="img" />
              {slowPreview && (
                <div className="stage-skeleton" role="status" aria-label="Rendering preview">
                  <LoaderCircle size={24} className="animate-spin text-muted-foreground" aria-hidden />
                </div>
              )}
              {avatarMode && avatarSource && (
                <div
                  className={`avatar-live-clip is-${config.avatarShape ?? 'circle'}`}
                  style={{
                    left: `${config.avatarZone.x * 100}%`,
                    top: `${config.avatarZone.y * 100}%`,
                    width: `${config.avatarZone.width * 100}%`,
                    height: `${config.avatarZone.height * 100}%`,
                  }}
                >
                  <DurablePortrait
                    src={avatarSource}
                    className="avatar-live-layer"
                    style={cropLayerStyle(config.avatarCrop ?? defaultCrop)}
                  />
                </div>
              )}
              {cutMode && (isLiveGif(config) || usesPhotoMotion(config)) && (config.gifSourceDataUrl || config.customImage) && (
                <img
                  className={`meme-photo-layer is-${config.photoMotion ?? 'still'} ${cropMode === 'image' ? 'is-cropping' : ''}`}
                  src={config.gifSourceDataUrl || publicAssetUrl(config.customImage)}
                  alt=""
                  style={cropLayerStyle(config.imageCrop ?? defaultCrop)}
                />
              )}
              {cutMode && config.effect === 'fire' && <div className="meme-fire-veil" />}
              {cutMode && liveMotion && config.layers.map((layer) => (
                <div
                  key={`live-${layer.id}`}
                  className={`meme-live-layer is-${config.animation} is-text-${layer.animation ?? 'still'}`}
                  style={{
                    left: `${layer.x * 100}%`,
                    top: `${layer.y * 100}%`,
                    width: `${layer.width * 100}%`,
                    height: `${layer.height * 100}%`,
                    fontSize: `clamp(18px, ${layer.fontSize * 0.42}px, 64px)`,
                    color: layer.color,
                    textAlign: layer.align,
                    WebkitTextStroke: layer.outline ? '2.4px #111' : '0',
                    textShadow: layer.animation === 'glow'
                      ? `0 0 18px ${layer.highlightColor || layer.color}`
                      : layer.outline ? '-2px -2px 0 #111, 2px -2px 0 #111, -2px 2px 0 #111, 2px 2px 0 #111, 0 3px 0 #111' : 'none',
                    background: layer.boxFill,
                  }}
                >
                  <StyledLayerText text={renderMerge(layer.text, contact)} highlight={layer.highlight} color={layer.highlightColor} />
                </div>
              ))}
              {cropMode === 'off' && paperMode && (
                <div
                  className={`canvas-zone ${activeCanvasZone === 'note' ? 'is-active' : ''}`}
                  style={{ left: `${config.noteZone.x * 100}%`, top: `${config.noteZone.y * 100}%`, width: `${config.noteZone.width * 100}%`, height: `${config.noteZone.height * 100}%` }}
                  onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'note', false); }}
                >
                  <span>Note</span>
                  <button type="button" aria-label="Resize note" className="zone-handle" onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'note', true); }} />
                </div>
              )}
              {cropMode === 'off' && avatarMode && (
                <div
                  className={`canvas-zone image-zone ${activeCanvasZone === 'avatar' ? 'is-active' : ''}`}
                  style={{ left: `${config.avatarZone.x * 100}%`, top: `${config.avatarZone.y * 100}%`, width: `${config.avatarZone.width * 100}%`, height: `${config.avatarZone.height * 100}%` }}
                  onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'avatar', false); }}
                >
                  <span>Avatar</span>
                  <button type="button" aria-label="Resize avatar" className="zone-handle" onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'avatar', true); }} />
                </div>
              )}
              {cropMode === 'off' && avatarMode && (
                <div
                  className={`canvas-zone text-zone ${activeCanvasZone === 'text' ? 'is-active' : ''}`}
                  style={{ left: `${config.textZone.x * 100}%`, top: `${config.textZone.y * 100}%`, width: `${config.textZone.width * 100}%`, height: `${config.textZone.height * 100}%` }}
                  onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'text', false); }}
                >
                  <span>Text</span>
                  <button type="button" aria-label="Resize text" className="zone-handle" onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'text', true); }} />
                </div>
              )}
              {cropMode === 'off' && cutMode && !liveMotion && activeLayer && (
                <div
                  className={`canvas-zone ${activeCanvasZone === 'text' ? 'is-active' : ''}`}
                  style={{ left: `${activeLayer.x * 100}%`, top: `${activeLayer.y * 100}%`, width: `${activeLayer.width * 100}%`, height: `${activeLayer.height * 100}%` }}
                  onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'text', false); }}
                >
                  <span>{activeLayer.name}</span>
                  <button type="button" aria-label="Resize text zone" className="zone-handle" onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'text', true); }} />
                </div>
              )}
              {cropMode === 'off' && cutMode && !liveMotion && config.websiteColumn && (
                <div className={`canvas-zone image-zone ${activeCanvasZone === 'website' ? 'is-active' : ''}`} style={{ left: `${config.websiteZone.x * 100}%`, top: `${config.websiteZone.y * 100}%`, width: `${config.websiteZone.width * 100}%`, height: `${config.websiteZone.height * 100}%` }} onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'website', false); }}>
                  <span>Website image</span><button type="button" aria-label="Resize website image zone" className="zone-handle" onPointerDown={(event) => { event.stopPropagation(); beginZoneDrag(event, 'website', true); }} />
                </div>
              )}
              {cropMode !== 'off' && (
                <>
                  <div
                    className="crop-window"
                    style={{
                      left: `${(cropMode === 'avatar' ? config.avatarZone.x : paperMode ? config.noteZone.x : 0) * 100}%`,
                      top: `${(cropMode === 'avatar' ? config.avatarZone.y : paperMode ? config.noteZone.y : 0) * 100}%`,
                      width: `${(cropMode === 'avatar' ? config.avatarZone.width : paperMode ? config.noteZone.width : 1) * 100}%`,
                      height: `${(cropMode === 'avatar' ? config.avatarZone.height : paperMode ? config.noteZone.height : 1) * 100}%`,
                    }}
                  />
                  <div className="crop-hint">{cropMode === 'avatar' ? 'Drag to pan the avatar · scroll to zoom' : 'Drag to pan the photo · scroll to zoom'}</div>
                </>
              )}
            </div>
          </div>
          {cutMode && (
            <SampleStrip
              selectedSrc={config.gifSourceDataUrl ?? config.customImage}
              samples={gallerySamples}
              onPick={applyMemeSample}
              onAddLive={importLiveMeme}
              onClear={(config.customImage || config.gifSourceDataUrl)
                ? (mode === 'memes' ? removeCurrentMeme : () => clearUploadedImage('background'))
                : undefined}
              onRemove={mode === 'memes' ? removeLibraryMeme : undefined}
              clearLabel={mode === 'memes' ? 'Remove meme' : 'Remove uploaded image'}
            />
          )}
        </main>

        {desktop && (
          <aside className="ink-well" aria-label="Inspector">
            {inspector}
          </aside>
        )}
      </div>

      {!desktop && (
        <>
          <div className="mobile-action-bar">
            {(['copy', 'look', 'ship'] as DeskTab[]).map((tab) => (
              <button
                type="button"
                key={tab}
                className={`btn btn-quiet flex-1 capitalize ${deskTab === tab && inspectorOpen ? 'text-primary' : ''}`}
                aria-pressed={deskTab === tab && inspectorOpen}
                onClick={() => { setDeskTab(tab); setInspectorOpen(true); }}
              >
                {tab === 'copy' ? <Type size={16} aria-hidden /> : tab === 'look' ? <Palette size={16} aria-hidden /> : <Send size={16} aria-hidden />} {tab}
              </button>
            ))}
            <button type="button" className="btn btn-primary flex-1" onClick={() => { if (generating) { void generateBatch(); } else { setDeskTab('ship'); setInspectorOpen(true); } }}>
              {generating ? <><Pause size={16} aria-hidden /> Cancel</> : <><Wand2 size={16} aria-hidden /> Generate</>}
            </button>
          </div>
          <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
            <SheetContent side="bottom" className="sheet-inspector h-[90dvh] gap-0 border-border bg-card shadow-[var(--shadow-overlay)] [&>button]:right-3 [&>button]:top-1 [&>button]:z-10 [&>button]:h-11 [&>button]:w-11 [&>button]:rounded-md [&>button]:opacity-100 [&>button>svg]:mx-auto [&>button>svg]:h-5 [&>button>svg]:w-5">
              <SheetTitle className="sr-only">Inspector</SheetTitle>
              <SheetDescription className="sr-only">Copy, look and ship controls for this campaign.</SheetDescription>
              <div className="flex min-h-0 flex-1 flex-col pr-12">{inspector}</div>
            </SheetContent>
          </Sheet>
        </>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[min(1080px,calc(100vw-24px))] max-w-none flex-col gap-4 overflow-hidden rounded-[12px] border-border bg-card p-5 sm:max-w-none">
          <DialogHeader className="pr-10 text-left">
            <DialogTitle className="display text-2xl font-semibold">Review {studioLabel(mode)}</DialogTitle>
            <DialogDescription>
              Check every image for this studio before you export. Tick the rows you want, then download.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {assets.length ? (
              <BatchReview
                assets={assets}
                animatedExport={animatedExport}
                onToggle={(id, selected) => setAssets((current) => current.map((item) => (item.id === id ? { ...item, selected } : item)))}
                onSelectAll={() => setAssets((current) => current.map((item) => (item.status === 'failed' ? item : { ...item, selected: true })))}
                onClear={() => setAssets((current) => current.map((item) => ({ ...item, selected: false })))}
                onDownloadAsset={downloadAsset}
                onDownloadSelected={downloadZip}
                onCompress={compressWarnings}
                onRetry={retryAsset}
              />
            ) : (
              <p className="helper">Generate first, then every image for this studio appears here.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
