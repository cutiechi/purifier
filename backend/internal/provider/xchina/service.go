package xchina

import (
	"context"
	"fmt"
	"net/url"
	"strconv"

	"purifier/internal/core/upstream"
	"purifier/internal/model"
	"purifier/internal/storage"
)

const XChinaSiteID = "2"
const XChinaHomeURL = "https://www.xbookcn.org"

type Service struct {
	client  *upstream.Client
	store   *storage.Store
	dataDir string
}

func NewService(client *upstream.Client, store *storage.Store, dataDir string) *Service {
	return &Service{
		client:  client,
		store:   store,
		dataDir: dataDir,
	}
}

// GetBook 获取小说详情与目录
func (s *Service) GetBook(ctx context.Context, cid string, refresh bool) (*BookDetail, error) {
	if err := upstream.AssertSafeID(cid); err != nil {
		return nil, fmt.Errorf("invalid cid: 400")
	}

	pageURL := fmt.Sprintf("%s/novel/%s", XChinaHomeURL, cid)
	cacheKey := fmt.Sprintf("%s:book:%s", XChinaSiteID, cid)

	var rawHTML string
	var fromCache bool

	if !refresh {
		cached, err := upstream.ReadContentCache(s.dataDir, XChinaSiteID, model.KindBook, cid, nil)
		if err == nil && cached != nil {
			rawHTML = cached.Data
			fromCache = true
		}
	}

	if rawHTML == "" {
		fetched, err := s.client.FetchSingleflight(ctx, cacheKey, func() (string, error) {
			return s.client.Fetch(ctx, pageURL)
		})
		if err != nil {
			return nil, err
		}
		rawHTML = fetched
	}

	extracted, err := ExtractToc(rawHTML)
	if err != nil {
		return nil, err
	}

	if !fromCache {
		_ = upstream.WriteContentCache(s.dataDir, XChinaSiteID, model.KindBook, cid, rawHTML, nil)
	}

	_ = s.store.RecordVisit(ctx, XChinaSiteID, model.KindBook, cid, extracted.Title, pageURL)

	return extracted, nil
}

// GetChapter 获取小说指定章节正文
func (s *Service) GetChapter(ctx context.Context, cid string, chapter int, refresh bool) (*ChapterDetail, error) {
	if err := upstream.AssertSafeID(cid); err != nil {
		return nil, fmt.Errorf("invalid cid: 400")
	}
	chStr := strconv.Itoa(chapter)
	if err := upstream.AssertSafeID(chStr); err != nil {
		return nil, fmt.Errorf("invalid chapter: 400")
	}

	pageURL := fmt.Sprintf("%s/novel/%s/%d", XChinaHomeURL, cid, chapter)
	cacheKey := fmt.Sprintf("%s:book:%s:%d", XChinaSiteID, cid, chapter)

	var rawHTML string
	var fromCache bool

	if !refresh {
		cached, err := upstream.ReadContentCache(s.dataDir, XChinaSiteID, model.KindBook, cid, &chStr)
		if err == nil && cached != nil {
			rawHTML = cached.Data
			fromCache = true
		}
	}

	if rawHTML == "" {
		fetched, err := s.client.FetchSingleflight(ctx, cacheKey, func() (string, error) {
			return s.client.Fetch(ctx, pageURL)
		})
		if err != nil {
			return nil, err
		}
		rawHTML = fetched
	}

	extracted, err := ExtractChapter(rawHTML, chapter, cid)
	if err != nil {
		return nil, err
	}

	if !fromCache {
		_ = upstream.WriteContentCache(s.dataDir, XChinaSiteID, model.KindBook, cid, rawHTML, &chStr)
	}

	titleToRecord := extracted.BookTitle
	if titleToRecord == "" {
		titleToRecord = extracted.Title
	}
	_ = s.store.RecordVisit(ctx, XChinaSiteID, model.KindBook, cid, titleToRecord, pageURL)

	return extracted, nil
}

// Browse 标签或关键词搜索
func (s *Service) Browse(ctx context.Context, categoryType, keywords string, page int) (*model.CategoryPage, error) {
	if page < 1 {
		page = 1
	}

	category := categoryType
	if category == "" {
		category = keywords
	}

	var targetURL string
	if categoryType != "" {
		targetURL = fmt.Sprintf("%s/tag/%s", XChinaHomeURL, url.PathEscape(categoryType))
		if page > 1 {
			targetURL += fmt.Sprintf("/%d", page)
		}
	} else if keywords != "" {
		targetURL = fmt.Sprintf("%s/search?q=%s", XChinaHomeURL, url.QueryEscape(keywords))
		if page > 1 {
			targetURL += fmt.Sprintf("&page=%d", page)
		}
	} else {
		return nil, fmt.Errorf("missing type or keywords")
	}

	rawHTML, err := s.client.Fetch(ctx, targetURL)
	if err != nil {
		return nil, err
	}

	links := ParseNovelCards(rawHTML)
	var nextPage *int
	if HasNextPage(rawHTML) {
		np := page + 1
		nextPage = &np
	}

	return &model.CategoryPage{
		Category: category,
		Links:    links,
		NextPage: nextPage,
	}, nil
}

// GetHome 获取小说书库首页精选
func (s *Service) GetHome(ctx context.Context) (*model.CategoryPage, error) {
	rawHTML, err := s.client.Fetch(ctx, XChinaHomeURL)
	if err != nil {
		return nil, err
	}

	links := ParseNovelCards(rawHTML)
	return &model.CategoryPage{
		Category: "热门推荐",
		Links:    links,
	}, nil
}

