package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"

	"purifier/internal/model"
	"purifier/internal/pkg/httputil"
	"purifier/internal/provider/cool18"
	"purifier/internal/provider/xchina"
)

type SearchHandler struct {
	cool18Svc *cool18.Service
	xchinaSvc *xchina.Service
}

func NewSearchHandler(cool18Svc *cool18.Service, xchinaSvc *xchina.Service) *SearchHandler {
	return &SearchHandler{
		cool18Svc: cool18Svc,
		xchinaSvc: xchinaSvc,
	}
}

type siteSearchResult struct {
	site  string
	page  *model.CategoryPage
	error error
}

func (h *SearchHandler) HandleSearch(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "missing q parameter"}, httputil.NoStoreHeaders)
		return
	}
	if len(q) > 200 {
		httputil.JSON(w, http.StatusBadRequest, map[string]string{"error": "q too long"}, httputil.NoStoreHeaders)
		return
	}

	page := 1
	if p, err := strconv.Atoi(r.URL.Query().Get("page")); err == nil && p > 1 {
		page = p
	}

	ctx := r.Context()
	var wg sync.WaitGroup
	results := make([]siteSearchResult, 2)

	// Site 1: Cool18
	wg.Add(1)
	go func() {
		defer wg.Done()
		res, err := h.cool18Svc.Browse(ctx, "", q, page)
		results[0] = siteSearchResult{site: "1", page: res, error: err}
	}()

	// Site 2: XChina
	wg.Add(1)
	go func() {
		defer wg.Done()
		res, err := h.xchinaSvc.Browse(ctx, "", q, page)
		results[1] = siteSearchResult{site: "2", page: res, error: err}
	}()

	wg.Wait()

	var items []model.MergedSearchItem
	errorsMap := make(map[string]string)
	var nextPage *int
	failedCount := 0

	for _, res := range results {
		if res.error != nil {
			failedCount++
			errorsMap[res.site] = res.error.Error()
			continue
		}
		if res.page != nil {
			kind := model.KindPost
			if res.site == "2" {
				kind = model.KindBook
			}
			for _, link := range res.page.Links {
				items = append(items, model.MergedSearchItem{
					Site: res.site,
					Kind: kind,
					Link: link,
				})
			}
			if res.page.NextPage != nil {
				nextPage = res.page.NextPage
			}
		}
	}

	if failedCount == len(results) {
		httputil.JSON(w, http.StatusBadGateway, map[string]string{"error": "all search upstreams failed"}, httputil.NoStoreHeaders)
		return
	}

	// 稳定排序：按标题比较，平局保持已有顺序（Site 1 在前）
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].Link.Title < items[j].Link.Title
	})

	resp := model.MergedSearchPage{
		Items:    items,
		NextPage: nextPage,
	}
	if len(errorsMap) > 0 {
		resp.Errors = errorsMap
	}

	httputil.JSON(w, http.StatusOK, resp, httputil.NoStoreHeaders)
}
