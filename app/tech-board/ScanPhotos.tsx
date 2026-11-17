"use client";

import { tekAttachLabel, type ScanPhotoView } from "./bayscan";

/** Thumbnails for a scan's check-in photos. Each links to the full image behind the dashboard login. */
export function ScanPhotos({ photos = [], pending = false }: { photos?: ScanPhotoView[]; pending?: boolean }) {
  if (!photos.length && !pending) return null;
  return (
    <div className="tb-scan-photos" data-testid="scan-photos">
      {pending && photos.length === 0 ? <span className="tb-photo-pending">Photo requested…</span> : null}
      {photos.map((photo) => {
        const label = tekAttachLabel(photo.attachStatus, photo.attachError);
        return (
          <a key={photo.id} href={`/bayscan/photo/${photo.id}`}>
            <img src={`/bayscan/photo/${photo.id}`} alt={`Bay Scan photo ${photo.id}`} />
            {label ? <span className={`tb-tek tb-tek-${photo.attachStatus}`}>{label}</span> : null}
          </a>
        );
      })}
    </div>
  );
}
