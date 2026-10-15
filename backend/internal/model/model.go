package model

type ItemKind string

const (
	KindPost ItemKind = "post"
	KindBook ItemKind = "book"
)

type Item struct {
	Site          string   `json:"site" db:"site"`
	Kind          ItemKind `json:"kind" db:"kind"`
	ID            string   `json:"id" db:"id"`
	Title         string   `json:"title" db:"title"`
	URL           string   `json:"url" db:"url"`
	FirstSeenAt   int64    `json:"first_seen_at" db:"first_seen_at"`
	LastVisitedAt int64    `json:"last_visited_at" db:"last_visited_at"`
	VisitCount    int      `json:"visit_count" db:"visit_count"`
	ReadProgress  *float64 `json:"read_progress,omitempty" db:"read_progress"`
	LastChapter   *int     `json:"last_chapter,omitempty" db:"last_chapter"`
}

type Favorite struct {
	Site        string   `json:"site" db:"site"`
	Kind        ItemKind `json:"kind" db:"kind"`
	ID          string   `json:"id" db:"id"`
	FavoritedAt int64    `json:"favorited_at" db:"favorited_at"`
}

type Tag struct {
	Site      string   `json:"site" db:"site"`
	Kind      ItemKind `json:"kind" db:"kind"`
	ID        string   `json:"id" db:"id"`
	Tag       string   `json:"tag" db:"tag"`
	CreatedAt int64    `json:"created_at" db:"created_at"`
}

type TagCount struct {
	Tag   string `json:"tag" db:"tag"`
	Count int    `json:"count" db:"count"`
}

type Bookmark struct {
	ID             int64    `json:"id" db:"id"`
	Site           string   `json:"site" db:"site"`
	Kind           ItemKind `json:"kind" db:"kind"`
	ItemID         string   `json:"item_id" db:"item_id"`
	Chapter        *int     `json:"chapter,omitempty" db:"chapter"`
	Quote          string   `json:"quote" db:"quote"`
	Note           string   `json:"note" db:"note"`
	ScrollProgress float64  `json:"scroll_progress" db:"scroll_progress"`
	CreatedAt      int64    `json:"created_at" db:"created_at"`
}

type Group struct {
	ID          int64       `json:"id" db:"id"`
	Key         string      `json:"key" db:"key"`
	Title       string      `json:"title" db:"title"`
	Author      *string     `json:"author,omitempty" db:"author"`
	Genre       *string     `json:"genre,omitempty" db:"genre"`
	Favorited   int         `json:"favorited" db:"favorited"`
	FavoritedAt *int64      `json:"favorited_at,omitempty" db:"favorited_at"`
	CreatedAt   int64       `json:"created_at" db:"created_at"`
	UpdatedAt   int64       `json:"updated_at" db:"updated_at"`
	Items       []GroupItem `json:"items,omitempty"`
}

type GroupItem struct {
	GroupID int64  `json:"group_id" db:"group_id"`
	Tid     string `json:"tid" db:"tid"`
	Title   string `json:"title" db:"title"`
	AddedAt int64  `json:"added_at" db:"added_at"`
}

type JobStatus string

const (
	JobStatusPending  JobStatus = "pending"
	JobStatusRunning  JobStatus = "running"
	JobStatusPaused   JobStatus = "paused"
	JobStatusFinished JobStatus = "finished"
	JobStatusError    JobStatus = "error"
)

type Job struct {
	ID         int64     `json:"id" db:"id"`
	Type       string    `json:"type" db:"type"`
	Status     JobStatus `json:"status" db:"status"`
	Payload    *string   `json:"payload,omitempty" db:"payload"`
	Result     *string   `json:"result,omitempty" db:"result"`
	Error      *string   `json:"error,omitempty" db:"error"`
	StartedAt  *int64    `json:"started_at,omitempty" db:"started_at"`
	FinishedAt *int64    `json:"finished_at,omitempty" db:"finished_at"`
	CreatedAt  int64     `json:"created_at" db:"created_at"`
}

type JobLog struct {
	ID        int64  `json:"id" db:"id"`
	JobID     int64  `json:"job_id" db:"job_id"`
	Level     string `json:"level" db:"level"`
	Message   string `json:"message" db:"message"`
	CreatedAt int64  `json:"created_at" db:"created_at"`
}

type ArchivePost struct {
	Site        string `json:"site" db:"site"`
	Tid         string `json:"tid" db:"tid"`
	Title       string `json:"title" db:"title"`
	FirstSeenAt int64  `json:"first_seen_at" db:"first_seen_at"`
	ArchivedAt  int64  `json:"archived_at" db:"archived_at"`
}

type ReadingSession struct {
	ID        int64    `json:"id" db:"id"`
	Site      string   `json:"site" db:"site"`
	Kind      ItemKind `json:"kind" db:"kind"`
	ItemID    string   `json:"item_id" db:"item_id"`
	Title     string   `json:"title" db:"title"`
	StartedAt int64    `json:"started_at" db:"started_at"`
	DurationS *int     `json:"duration_s,omitempty" db:"duration_s"`
	Estimated int      `json:"estimated" db:"estimated"`
}

type CharacterScope struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type CharacterCluster struct {
	ID    int64    `json:"id"`
	Hue   int      `json:"hue"`
	Names []string `json:"names"`
}

type ChapterLink struct {
	Index int    `json:"index"`
	Title string `json:"title"`
	Tid   string `json:"tid"`
}

type CategoryPage struct {
	Category string        `json:"category"`
	Links    []ChapterLink `json:"links"`
	NextPage *int          `json:"nextPage,omitempty"`
}

type MergedSearchItem struct {
	Site string      `json:"site"`
	Kind ItemKind    `json:"kind"`
	Link ChapterLink `json:"link"`
}

type MergedSearchPage struct {
	Items    []MergedSearchItem `json:"items"`
	NextPage *int               `json:"nextPage"`
	Errors   map[string]string  `json:"errors,omitempty"`
}

