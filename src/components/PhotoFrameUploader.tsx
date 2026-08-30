import {useRef, useState, type FormEvent} from 'react';
import {ImagePlus, LoaderCircle, X} from 'lucide-react';

import {ApiError} from '../api/productData';
import type {ShopBoardObject} from '../types';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface PhotoFrameUploaderProps {
  frame: ShopBoardObject & {itemType: 'photo_frame'};
  onClose: () => void;
  onSave: (file: File, expectedRevision: string) => Promise<void>;
}

export default function PhotoFrameUploader({
  frame,
  onClose,
  onSave,
}: PhotoFrameUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || isProcessing) return;
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      setError('Choose a non-empty JPEG, PNG, or WebP image no larger than 5 MB.');
      return;
    }
    setError(null);
    setIsProcessing(true);
    try {
      await onSave(file, frame.photo?.revision ?? '0');
      onClose();
    } catch (uploadError) {
      if (uploadError instanceof ApiError && uploadError.code === 'PHOTO_REVISION_CONFLICT') {
        setError('This photo changed in another request. Reload the board, then try again.');
      } else if (uploadError instanceof ApiError && uploadError.code === 'PHOTO_TOO_LARGE') {
        setError('The image is larger than the 5 MB upload limit.');
      } else if (uploadError instanceof ApiError && uploadError.code === 'INVALID_PHOTO_IMAGE') {
        setError('That file is not a valid JPEG, PNG, or WebP image.');
      } else {
        setError('The photo could not be processed. You can retry with the same file.');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-frame-upload-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#18181b] p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="photo-frame-upload-title" className="text-lg font-bold text-slate-100">
              {frame.photo ? 'Replace photo' : 'Upload photo'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              JPEG, PNG, or WebP. Maximum 5 MB. Go Study removes metadata and stores a sanitized WebP.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close photo uploader"
            onClick={onClose}
            disabled={isProcessing}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
          disabled={isProcessing}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isProcessing}
          className="mt-5 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-400/35 bg-indigo-500/[0.06] px-5 py-8 text-indigo-200 transition hover:border-indigo-300/60 hover:bg-indigo-500/10 disabled:cursor-wait disabled:opacity-60"
        >
          <ImagePlus className="h-8 w-8" />
          <span className="text-sm font-semibold">{file ? 'Image selected' : 'Choose an image'}</span>
          <span className="text-xs text-slate-500">The original filename is not stored or displayed.</span>
        </button>

        {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}

        <button
          type="submit"
          disabled={!file || isProcessing}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isProcessing ? (
            <><LoaderCircle className="h-4 w-4 animate-spin" /> Processing securely…</>
          ) : frame.photo ? 'Replace photo' : 'Upload photo'}
        </button>
      </form>
    </div>
  );
}
