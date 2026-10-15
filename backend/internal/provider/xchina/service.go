package xchina

import (
	"context"
	"fmt"
	"net/http"
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
		return nil, upstream.NewExtractorError("invalid cid", http.StatusBadRequest)
	}

	pageURL := fmt.Sprintf("%s/novel/%s", XChinaHomeURL, cid)
	cacheKey := fmt.Sprintf("%s:book:%s", XChinaSiteID, cid)

	var rawHTML string
	var fromCache bool
	var stale bool
	var refreshErr string

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
			if refresh {
				// 刷新失败回退旧缓存（与 cool18 一致）
				cached, cErr := upstream.ReadContentCache(s.dataDir, XChinaSiteID, model.KindBook, cid, nil)
				if cErr == nil && cached != nil {
					rawHTML = cached.Data
					stale = true
					refreshErr = err.Error()
				} else {
					return nil, err
				}
			} else {
				return nil, err
			}
		} else {
			rawHTML = fetched
		}
	}

	extracted, err := ExtractToc(rawHTML)
	if err != nil {
		return nil, err
	}
	extracted.Stale = stale
	extracted.RefreshError = refreshErr

	if !fromCache && !stale {
		_ = upstream.WriteContentCache(s.dataDir, XChinaSiteID, model.KindBook, cid, rawHTML, nil)
	}

	_ = s.store.RecordVisit(ctx, XChinaSiteID, model.KindBook, cid, extracted.Title, pageURL)

	return extracted, nil
}

// GetChapter 获取小说指定章节正文
func (s *Service) GetChapter(ctx context.Context, cid string, chapter int, refresh bool) (*ChapterDetail, error) {
	if err := upstream.AssertSafeID(cid); err != nil {
		return nil, upstream.NewExtractorError("invalid cid", http.StatusBadRequest)
	}
	chStr := strconv.Itoa(chapter)
	if err := upstream.AssertSafeID(chStr); err != nil {
		return nil, upstream.NewExtractorError("invalid chapter", http.StatusBadRequest)
	}

	pageURL := fmt.Sprintf("%s/novel/%s/%d", XChinaHomeURL, cid, chapter)
	cacheKey := fmt.Sprintf("%s:book:%s:%d", XChinaSiteID, cid, chapter)

	var rawHTML string
	var fromCache bool
	var stale bool
	var refreshErr string

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
			if refresh {
				cached, cErr := upstream.ReadContentCache(s.dataDir, XChinaSiteID, model.KindBook, cid, &chStr)
				if cErr == nil && cached != nil {
					rawHTML = cached.Data
					stale = true
					refreshErr = err.Error()
				} else {
					return nil, err
				}
			} else {
				return nil, err
			}
		} else {
			rawHTML = fetched
		}
	}

	extracted, err := ExtractChapter(rawHTML, chapter, cid)
	if err != nil {
		return nil, err
	}
	extracted.Stale = stale
	extracted.RefreshError = refreshErr

	if !fromCache && !stale {
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
		return nil, upstream.NewExtractorError("missing type or keywords", http.StatusBadRequest)
	}

	rawHTML, err := s.client.Fetch(ctx, targetURL)
	if err != nil {
		// 题材 slug 不存在时上游 404：视为「无匹配」而非服务错误
		if code, _ := upstream.ErrorStatus(err); code == http.StatusNotFound {
			return &model.CategoryPage{Category: category, Links: []model.ChapterLink{}}, nil
		}
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

// GetCategories 书库题材入口（主题浏览 + 有声）
func (s *Service) GetCategories(ctx context.Context) ([]model.CategoryLink, error) {
	rawHTML, err := s.client.FetchSingleflight(ctx, "xchina:home:html", func() (string, error) {
		return s.client.Fetch(ctx, XChinaHomeURL)
	})
	if err != nil {
		return nil, err
	}
	return ParseCategoryLinks(rawHTML), nil
}

// GetTrending 书库今日热读榜
func (s *Service) GetTrending(ctx context.Context) ([]model.HotPost, error) {
	rawHTML, err := s.client.FetchSingleflight(ctx, "xchina:home:html", func() (string, error) {
		return s.client.Fetch(ctx, XChinaHomeURL)
	})
	if err != nil {
		return nil, err
	}
	return ParseHotPosts(rawHTML), nil
}

// HomeFeed 书库更新流（mtid 语义为页码：空/0 = 首页，n≥1 = /novels/n）
func (s *Service) HomeFeed(ctx context.Context, mtid string) (*HomeFeedResponse, error) {
	page := 0
	if mtid != "" {
		if err := upstream.AssertSafeID(mtid); err != nil {
			return nil, upstream.NewExtractorError("invalid mtid", http.StatusBadRequest)
		}
		n, convErr := strconv.Atoi(mtid)
		if convErr != nil || n < 0 {
			return nil, upstream.NewExtractorError("invalid mtid", http.StatusBadRequest)
		}
		page = n
	}

	targetURL := XChinaHomeURL
	if page >= 1 {
		targetURL = fmt.Sprintf("%s/novels/%d", XChinaHomeURL, page)
	}

	rawHTML, err := s.client.Fetch(ctx, targetURL)
	if err != nil {
		return nil, err
	}

	links := ParseNovelCards(rawHTML)
	var nextMtid *string
	if page >= 1 {
		if HasNextPage(rawHTML) {
			n := strconv.Itoa(page + 1)
			nextMtid = &n
		}
	} else if HasMoreLink(rawHTML, "/novels") {
		one := "1"
		nextMtid = &one
	}

	return &HomeFeedResponse{Links: links, NextMtid: nextMtid}, nil
}

// HomeFeedResponse 书库更新流响应
type HomeFeedResponse struct {
	Links    []model.ChapterLink `json:"links"`
	NextMtid *string             `json:"nextMtid,omitempty"`
}
