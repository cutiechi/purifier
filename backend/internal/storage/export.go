package storage

import (
	"context"
	"time"

	"purifier/internal/model"
)

type BackupExport struct {
	Version           int                      `json:"version"`
	ExportedAt        int64                    `json:"exportedAt"`
	Items             []model.Item             `json:"items"`
	Favorites         []model.Favorite         `json:"favorites"`
	Tags              []model.Tag              `json:"tags"`
	Bookmarks         []model.Bookmark         `json:"bookmarks"`
	Groups            []model.Group            `json:"groups"`
	ArchivePosts      []model.ArchivePost      `json:"archive_posts"`
	ArchiveCursors    []map[string]any         `json:"archive_cursors"`
	CharacterNames    []map[string]any         `json:"character_names"`
	CharacterClusters []map[string]any         `json:"character_clusters"`
	ReadingSessions   []model.ReadingSession   `json:"reading_sessions"`
}

func (s *Store) ExportBackup(ctx context.Context) (*BackupExport, error) {
	out := &BackupExport{
		Version:           3,
		ExportedAt:        time.Now().UnixMilli(),
		Items:             []model.Item{},
		Favorites:         []model.Favorite{},
		Tags:              []model.Tag{},
		Bookmarks:         []model.Bookmark{},
		Groups:            []model.Group{},
		ArchivePosts:      []model.ArchivePost{},
		ArchiveCursors:    []map[string]any{},
		CharacterNames:    []map[string]any{},
		CharacterClusters: []map[string]any{},
		ReadingSessions:   []model.ReadingSession{},
	}

	// 1. items
	rows, err := s.db.QueryContext(ctx, "SELECT site, kind, id, title, url, first_seen_at, last_visited_at, visit_count, read_progress, last_chapter FROM items")
	if err == nil {
		for rows.Next() {
			var it model.Item
			if err := rows.Scan(&it.Site, &it.Kind, &it.ID, &it.Title, &it.URL, &it.FirstSeenAt, &it.LastVisitedAt, &it.VisitCount, &it.ReadProgress, &it.LastChapter); err == nil {
				out.Items = append(out.Items, it)
			}
		}
		rows.Close()
	}

	// 2. favorites
	rows, err = s.db.QueryContext(ctx, "SELECT site, kind, id, favorited_at FROM favorites")
	if err == nil {
		for rows.Next() {
			var f model.Favorite
			if err := rows.Scan(&f.Site, &f.Kind, &f.ID, &f.FavoritedAt); err == nil {
				out.Favorites = append(out.Favorites, f)
			}
		}
		rows.Close()
	}

	// 3. tags
	rows, err = s.db.QueryContext(ctx, "SELECT site, kind, id, tag, created_at FROM tags")
	if err == nil {
		for rows.Next() {
			var t model.Tag
			if err := rows.Scan(&t.Site, &t.Kind, &t.ID, &t.Tag, &t.CreatedAt); err == nil {
				out.Tags = append(out.Tags, t)
			}
		}
		rows.Close()
	}

	// 4. bookmarks
	rows, err = s.db.QueryContext(ctx, "SELECT id, site, kind, item_id, chapter, quote, note, scroll_progress, created_at FROM bookmarks ORDER BY id")
	if err == nil {
		for rows.Next() {
			var b model.Bookmark
			if err := rows.Scan(&b.ID, &b.Site, &b.Kind, &b.ItemID, &b.Chapter, &b.Quote, &b.Note, &b.ScrollProgress, &b.CreatedAt); err == nil {
				out.Bookmarks = append(out.Bookmarks, b)
			}
		}
		rows.Close()
	}

	// 5. groups
	resGroups, err := s.ListGroups(ctx, GroupListQuery{})
	if err == nil && resGroups != nil {
		out.Groups = resGroups.Items
	}

	// 6. archive_posts
	rows, err = s.db.QueryContext(ctx, "SELECT site, tid, title, first_seen_at, archived_at FROM archive_posts ORDER BY site, tid")
	if err == nil {
		for rows.Next() {
			var p model.ArchivePost
			if err := rows.Scan(&p.Site, &p.Tid, &p.Title, &p.FirstSeenAt, &p.ArchivedAt); err == nil {
				out.ArchivePosts = append(out.ArchivePosts, p)
			}
		}
		rows.Close()
	}

	// 7. archive_cursors
	rows, err = s.db.QueryContext(ctx, "SELECT site, next_mtid, mode, status, pages, updated_at FROM archive_cursors")
	if err == nil {
		for rows.Next() {
			var site, mode, status string
			var nextMtid *string
			var pages int
			var updatedAt int64
			if err := rows.Scan(&site, &nextMtid, &mode, &status, &pages, &updatedAt); err == nil {
				out.ArchiveCursors = append(out.ArchiveCursors, map[string]any{
					"site":       site,
					"next_mtid":  nextMtid,
					"mode":       mode,
					"status":     status,
					"pages":      pages,
					"updated_at": updatedAt,
				})
			}
		}
		rows.Close()
	}

	// 8. character_names
	rows, err = s.db.QueryContext(ctx, "SELECT scope_type, scope_id, name, cluster_id, created_at FROM character_names ORDER BY scope_type, scope_id, name")
	if err == nil {
		for rows.Next() {
			var scopeType, scopeID, name string
			var clusterID int64
			var createdAt int64
			if err := rows.Scan(&scopeType, &scopeID, &name, &clusterID, &createdAt); err == nil {
				out.CharacterNames = append(out.CharacterNames, map[string]any{
					"scope_type": scopeType,
					"scope_id":   scopeID,
					"name":       name,
					"cluster_id": clusterID,
					"created_at": createdAt,
				})
			}
		}
		rows.Close()
	}

	// 9. character_clusters
	rows, err = s.db.QueryContext(ctx, "SELECT id, scope_type, scope_id, hue, created_at FROM character_clusters ORDER BY id")
	if err == nil {
		for rows.Next() {
			var id int64
			var scopeType, scopeID string
			var hue int
			var createdAt int64
			if err := rows.Scan(&id, &scopeType, &scopeID, &hue, &createdAt); err == nil {
				out.CharacterClusters = append(out.CharacterClusters, map[string]any{
					"id":         id,
					"scope_type": scopeType,
					"scope_id":   scopeID,
					"hue":        hue,
					"created_at": createdAt,
				})
			}
		}
		rows.Close()
	}

	// 10. reading_sessions
	rows, err = s.db.QueryContext(ctx, "SELECT id, site, kind, item_id, title, started_at, duration_s, estimated FROM reading_sessions ORDER BY started_at")
	if err == nil {
		for rows.Next() {
			var rs model.ReadingSession
			if err := rows.Scan(&rs.ID, &rs.Site, &rs.Kind, &rs.ItemID, &rs.Title, &rs.StartedAt, &rs.DurationS, &rs.Estimated); err == nil {
				out.ReadingSessions = append(out.ReadingSessions, rs)
			}
		}
		rows.Close()
	}

	return out, nil
}
