package storage

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strconv"
	"time"

	"purifier/internal/model"
)

var (
	ErrNotFound          = errors.New("not found")
	ErrInvalidInput      = errors.New("invalid input")
	ErrCharacterConflict = errors.New("character belongs to another cluster")
	ErrSingletonSplit    = errors.New("cannot split singleton")
	ErrInvalidHue        = errors.New("invalid hue")
)

func (s *Store) ResolveCharacterScope(ctx context.Context, kind, id string) (model.CharacterScope, error) {
	if kind == "book" {
		return model.CharacterScope{Type: "book", ID: id}, nil
	}

	var groupID int64
	err := s.db.QueryRowContext(ctx, "SELECT group_id FROM group_items WHERE tid = ? LIMIT 1", id).Scan(&groupID)
	if err == nil {
		return model.CharacterScope{Type: "group", ID: strconv.FormatInt(groupID, 10)}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return model.CharacterScope{}, err
	}

	return model.CharacterScope{Type: "post", ID: id}, nil
}

func (s *Store) ListClusters(ctx context.Context, scope model.CharacterScope) ([]model.CharacterCluster, error) {
	query := `
		SELECT c.id, c.hue, n.name
		FROM character_clusters c
		JOIN character_names n ON n.cluster_id = c.id
		WHERE c.scope_type = ? AND c.scope_id = ?
		ORDER BY c.created_at, c.id, n.rowid`

	rows, err := s.db.QueryContext(ctx, query, scope.Type, scope.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	clusterMap := make(map[int64]*model.CharacterCluster)
	var order []int64

	for rows.Next() {
		var id int64
		var hue int
		var name string
		if err := rows.Scan(&id, &hue, &name); err != nil {
			return nil, err
		}

		c, exists := clusterMap[id]
		if !exists {
			c = &model.CharacterCluster{
				ID:    id,
				Hue:   hue,
				Names: []string{},
			}
			clusterMap[id] = c
			order = append(order, id)
		}
		c.Names = append(c.Names, name)
	}

	result := make([]model.CharacterCluster, 0, len(order))
	for _, id := range order {
		result = append(result, *clusterMap[id])
	}
	return result, nil
}

func (s *Store) GetCluster(ctx context.Context, scope model.CharacterScope, clusterID int64) (*model.CharacterCluster, error) {
	clusters, err := s.ListClusters(ctx, scope)
	if err != nil {
		return nil, err
	}
	for _, c := range clusters {
		if c.ID == clusterID {
			return &c, nil
		}
	}
	return nil, ErrNotFound
}

func (s *Store) pruneEmptyClusters(ctx context.Context, tx *sql.Tx, scope *model.CharacterScope) error {
	var err error
	if scope != nil {
		query := `DELETE FROM character_clusters
			WHERE scope_type = ? AND scope_id = ?
			  AND id NOT IN (SELECT DISTINCT cluster_id FROM character_names)`
		if tx != nil {
			_, err = tx.ExecContext(ctx, query, scope.Type, scope.ID)
		} else {
			_, err = s.db.ExecContext(ctx, query, scope.Type, scope.ID)
		}
	} else {
		query := `DELETE FROM character_clusters
			WHERE id NOT IN (SELECT DISTINCT cluster_id FROM character_names)`
		if tx != nil {
			_, err = tx.ExecContext(ctx, query)
		} else {
			_, err = s.db.ExecContext(ctx, query)
		}
	}
	return err
}

func PickHue(used []int) int {
	seen := make(map[int]bool)
	var uniq []int
	for _, u := range used {
		if !seen[u] {
			seen[u] = true
			uniq = append(uniq, u)
		}
	}

	if len(uniq) == 0 {
		return 85
	}

	best := 0
	bestScore := -1

	for h := 0; h < 360; h++ {
		minD := 360
		for _, u := range uniq {
			raw := int(math.Abs(float64(h - u)))
			d := raw
			if 360-raw < d {
				d = 360 - raw
			}
			if d < minD {
				minD = d
			}
		}
		if minD > bestScore {
			bestScore = minD
			best = h
		}
	}
	return best
}

func (s *Store) AddCharacter(ctx context.Context, scope model.CharacterScope, name string, clusterID *int64) (*model.CharacterCluster, error) {
	var existingClusterID int64
	err := s.db.QueryRowContext(ctx,
		`SELECT cluster_id FROM character_names WHERE scope_type = ? AND scope_id = ? AND name = ?`,
		scope.Type, scope.ID, name,
	).Scan(&existingClusterID)

	if err == nil {
		if clusterID == nil || *clusterID == existingClusterID {
			return s.GetCluster(ctx, scope, existingClusterID)
		}
		return nil, ErrCharacterConflict
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	now := time.Now().Unix()

	if clusterID != nil {
		if _, err := s.GetCluster(ctx, scope, *clusterID); err != nil {
			return nil, err
		}
		_, err := s.db.ExecContext(ctx,
			`INSERT INTO character_names (scope_type, scope_id, name, cluster_id, created_at)
			 VALUES (?, ?, ?, ?, ?)`,
			scope.Type, scope.ID, name, *clusterID, now,
		)
		if err != nil {
			return nil, err
		}
		return s.GetCluster(ctx, scope, *clusterID)
	}

	clusters, err := s.ListClusters(ctx, scope)
	if err != nil {
		return nil, err
	}
	used := make([]int, len(clusters))
	for i, c := range clusters {
		used[i] = c.Hue
	}
	hue := PickHue(used)

	res, err := s.db.ExecContext(ctx,
		`INSERT INTO character_clusters (scope_type, scope_id, hue, created_at) VALUES (?, ?, ?, ?)`,
		scope.Type, scope.ID, hue, now,
	)
	if err != nil {
		return nil, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO character_names (scope_type, scope_id, name, cluster_id, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		scope.Type, scope.ID, name, newID, now,
	)
	if err != nil {
		return nil, err
	}

	return s.GetCluster(ctx, scope, newID)
}

func (s *Store) RemoveCharacter(ctx context.Context, scope model.CharacterScope, name string) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM character_names WHERE scope_type = ? AND scope_id = ? AND name = ?`,
		scope.Type, scope.ID, name,
	)
	if err != nil {
		return 0, err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	_ = s.pruneEmptyClusters(ctx, nil, &scope)
	return rows, nil
}

func (s *Store) MergeClusters(ctx context.Context, scope model.CharacterScope, clusterIDs []int64, hue int) ([]model.CharacterCluster, error) {
	if hue < 0 || hue > 359 {
		return nil, ErrInvalidHue
	}

	seen := make(map[int64]bool)
	var uniq []int64
	for _, id := range clusterIDs {
		if !seen[id] {
			seen[id] = true
			uniq = append(uniq, id)
		}
	}
	if len(uniq) < 2 {
		return nil, ErrInvalidInput
	}

	targetID := uniq[0]
	for _, id := range uniq {
		if _, err := s.GetCluster(ctx, scope, id); err != nil {
			return nil, err
		}
		if id < targetID {
			targetID = id
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	for _, id := range uniq {
		if id == targetID {
			continue
		}
		_, err := tx.ExecContext(ctx,
			`UPDATE character_names SET cluster_id = ? WHERE cluster_id = ? AND scope_type = ? AND scope_id = ?`,
			targetID, id, scope.Type, scope.ID,
		)
		if err != nil {
			return nil, err
		}
	}

	_, err = tx.ExecContext(ctx, `UPDATE character_clusters SET hue = ? WHERE id = ?`, hue, targetID)
	if err != nil {
		return nil, err
	}

	if err := s.pruneEmptyClusters(ctx, tx, &scope); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return s.ListClusters(ctx, scope)
}

func (s *Store) SplitCharacter(ctx context.Context, scope model.CharacterScope, clusterID int64, name string) ([]model.CharacterCluster, error) {
	cluster, err := s.GetCluster(ctx, scope, clusterID)
	if err != nil {
		return nil, err
	}

	hasName := false
	for _, n := range cluster.Names {
		if n == name {
			hasName = true
			break
		}
	}
	if !hasName {
		return nil, ErrNotFound
	}

	if len(cluster.Names) < 2 {
		return nil, ErrSingletonSplit
	}

	allClusters, err := s.ListClusters(ctx, scope)
	if err != nil {
		return nil, err
	}
	used := make([]int, len(allClusters))
	for i, c := range allClusters {
		used[i] = c.Hue
	}
	hue := PickHue(used)

	now := time.Now().Unix()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`INSERT INTO character_clusters (scope_type, scope_id, hue, created_at) VALUES (?, ?, ?, ?)`,
		scope.Type, scope.ID, hue, now,
	)
	if err != nil {
		return nil, err
	}
	newID, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}

	_, err = tx.ExecContext(ctx,
		`UPDATE character_names SET cluster_id = ? WHERE scope_type = ? AND scope_id = ? AND name = ?`,
		newID, scope.Type, scope.ID, name,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return s.ListClusters(ctx, scope)
}

func (s *Store) RecolorCluster(ctx context.Context, scope model.CharacterScope, clusterID int64, hue int) ([]model.CharacterCluster, error) {
	if hue < 0 || hue > 359 {
		return nil, ErrInvalidHue
	}
	if _, err := s.GetCluster(ctx, scope, clusterID); err != nil {
		return nil, err
	}

	_, err := s.db.ExecContext(ctx, `UPDATE character_clusters SET hue = ? WHERE id = ?`, hue, clusterID)
	if err != nil {
		return nil, err
	}

	return s.ListClusters(ctx, scope)
}
