import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FieldRow } from '@/components/studio/shared';
import {
  listCopyTemplates,
  removeCopyTemplate,
  saveCopyTemplate,
  type CopyStudio,
  type CopyTemplate,
} from '@/studio/cloud';

export function CopyTemplateControls({
  studio,
  userId,
  hint,
  onApply,
  onAnnounce,
}: {
  studio: CopyStudio;
  userId?: string;
  hint: string;
  onApply: (body: string, template: CopyTemplate) => void;
  onAnnounce?: (message: string) => void;
}) {
  const [copyTemplates, setCopyTemplates] = useState<CopyTemplate[]>([]);
  const [copyTemplateName, setCopyTemplateName] = useState('');
  const [copyTemplateBody, setCopyTemplateBody] = useState('');
  const [selectedCopyTemplateId, setSelectedCopyTemplateId] = useState('');
  const [savingCopyTemplate, setSavingCopyTemplate] = useState(false);
  const [removingCopyTemplate, setRemovingCopyTemplate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listCopyTemplates(studio, userId)
      .then((rows) => {
        if (!cancelled) setCopyTemplates(rows);
      })
      .catch(() => {
        if (!cancelled) setCopyTemplates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [studio, userId]);

  const addCopyTemplate = async () => {
    const name = copyTemplateName.trim();
    const body = copyTemplateBody.trim();
    if (!name || !body || savingCopyTemplate) return;
    setSavingCopyTemplate(true);
    const result = await saveCopyTemplate(studio, name, body, userId);
    const rows = await listCopyTemplates(studio, userId);
    setCopyTemplates(rows);
    setSelectedCopyTemplateId(result.template.id);
    setCopyTemplateName('');
    setCopyTemplateBody('');
    setSavingCopyTemplate(false);
    if (result.syncError) {
      toast('Template kept in this browser', { description: result.syncError });
      return;
    }
    toast(result.template.cloud ? 'Template saved' : 'Template saved in this browser', { description: result.template.name });
    onAnnounce?.(`Template ${result.template.name} saved`);
  };

  const removeSelectedCopyTemplate = async () => {
    const match = copyTemplates.find((item) => item.id === selectedCopyTemplateId);
    if (!match || removingCopyTemplate) return;
    setRemovingCopyTemplate(true);
    const result = await removeCopyTemplate(match, userId);
    const rows = await listCopyTemplates(studio, userId);
    setRemovingCopyTemplate(false);
    if (result.syncError) {
      setCopyTemplates(rows);
      toast('Template stayed in Supabase', { description: result.syncError });
      return;
    }
    setCopyTemplates(rows.filter((item) => item.id !== match.id && item.name.toLowerCase() !== match.name.toLowerCase()));
    setSelectedCopyTemplateId('');
    toast('Template removed', { description: match.name });
    onAnnounce?.(`Template ${match.name} removed`);
  };

  const applyCopyTemplate = (id: string) => {
    setSelectedCopyTemplateId(id);
    const match = copyTemplates.find((item) => item.id === id);
    if (!match) return;
    onApply(match.body, match);
    onAnnounce?.(`Template ${match.name} applied`);
  };

  return (
    <>
      <div className="copy-template-table">
        <table>
          <caption className="sr-only">New message template</caption>
          <thead>
            <tr>
              <th id={`copy-template-name-label-${studio}`} scope="col">Name</th>
              <th id={`copy-template-body-label-${studio}`} scope="col">Copy</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input
                  id="copy-template-name"
                  className="field"
                  aria-labelledby={`copy-template-name-label-${studio}`}
                  value={copyTemplateName}
                  maxLength={80}
                  placeholder="Follow-up"
                  onChange={(event) => setCopyTemplateName(event.target.value)}
                />
              </td>
              <td>
                <textarea
                  id="copy-template-body"
                  className="field"
                  aria-labelledby={`copy-template-body-label-${studio}`}
                  rows={3}
                  value={copyTemplateBody}
                  maxLength={8000}
                  placeholder="Hi {first_name}, …"
                  onChange={(event) => setCopyTemplateBody(event.target.value)}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn btn-quiet"
        disabled={!copyTemplateName.trim() || !copyTemplateBody.trim()}
        data-loading={savingCopyTemplate || undefined}
        aria-busy={savingCopyTemplate || undefined}
        onClick={() => void addCopyTemplate()}
      >
        <Plus size={16} aria-hidden /> Add template
      </button>
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <FieldRow id="copy-template-select" label="Select">
            <select
              id="copy-template-select"
              className="field"
              value={selectedCopyTemplateId}
              onChange={(event) => applyCopyTemplate(event.target.value)}
            >
              <option value="">{copyTemplates.length ? 'Choose a template' : 'No templates yet'}</option>
              {copyTemplates.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </FieldRow>
        </div>
        <button
          type="button"
          className="btn btn-danger flex-none"
          disabled={!selectedCopyTemplateId || removingCopyTemplate}
          data-loading={removingCopyTemplate || undefined}
          aria-busy={removingCopyTemplate || undefined}
          onClick={() => void removeSelectedCopyTemplate()}
        >
          <Trash2 size={16} aria-hidden /> Remove
        </button>
      </div>
      <p className="helper">{hint}</p>
    </>
  );
}
