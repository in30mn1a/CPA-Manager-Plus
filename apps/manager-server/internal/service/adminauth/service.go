package adminauth

import (
	"context"
	"errors"

	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/config"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/security"
	"github.com/seakee/cpa-manager-plus/apps/manager-server/internal/store"
)

type Service struct {
	cfg   config.Config
	store *store.Store
}

func New(cfg config.Config, store *store.Store) *Service {
	return &Service{cfg: cfg, store: store}
}

func (s *Service) VerifyHeader(ctx context.Context, authorizationHeader string) (bool, error) {
	credential, ok, err := s.store.LoadAdminCredential(ctx)
	if err != nil {
		return false, err
	}
	if !ok {
		return false, errors.New("admin credential is not initialized")
	}
	return security.VerifyAdminKey(credential, security.ExtractBearerToken(authorizationHeader)), nil
}

func (s *Service) VerifyPanelHeader(ctx context.Context, authorizationHeader string) (bool, error) {
	if ok, err := s.VerifyHeader(ctx, authorizationHeader); err != nil || ok {
		return ok, err
	}
	token := security.ExtractBearerToken(authorizationHeader)
	if token == "" {
		return false, nil
	}
	cfg, ok, err := s.store.LoadManagerConfig(ctx)
	if err != nil {
		return false, err
	}
	if ok && cfg.ExternalUsageService.Enabled && cfg.CPAConnection.ManagementKey != "" {
		return security.EqualHMAC(token, cfg.CPAConnection.ManagementKey), nil
	}
	return false, nil
}

func (s *Service) VerifySubmittedExternalConfigHeader(ctx context.Context, authorizationHeader string, cfg store.ManagerConfig) (bool, error) {
	if ok, err := s.VerifyPanelHeader(ctx, authorizationHeader); err != nil || ok {
		return ok, err
	}
	token := security.ExtractBearerToken(authorizationHeader)
	if token == "" || !cfg.ExternalUsageService.Enabled || cfg.CPAConnection.ManagementKey == "" {
		return false, nil
	}
	if !security.EqualHMAC(token, cfg.CPAConnection.ManagementKey) {
		return false, nil
	}
	if s.cfg.CPAUpstreamURL != "" && s.cfg.ManagementKey != "" {
		return false, nil
	}
	current, ok, err := s.store.LoadManagerConfig(ctx)
	if err != nil {
		return false, err
	}
	if ok {
		return current.ExternalUsageService.Enabled &&
			current.CPAConnection.ManagementKey != "" &&
			security.EqualHMAC(token, current.CPAConnection.ManagementKey), nil
	}
	setup, ok, err := s.store.LoadSetup(ctx)
	if err != nil {
		return false, err
	}
	if ok && setup.ManagementKey != "" {
		return false, nil
	}
	return true, nil
}

func (s *Service) PanelUsesExternalManagementKey(ctx context.Context) (bool, error) {
	cfg, ok, err := s.store.LoadManagerConfig(ctx)
	if err != nil || !ok {
		return false, err
	}
	return cfg.ExternalUsageService.Enabled && cfg.CPAConnection.ManagementKey != "", nil
}
