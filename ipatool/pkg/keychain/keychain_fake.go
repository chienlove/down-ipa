//go:build !darwin

package keychain

// Keychain is a fake implementation for non-macOS systems like Linux.
type Keychain struct{}

// New returns a new fake Keychain instance.
func New() (*Keychain, error) {
	return &Keychain{}, nil
}

// Set is a no-op fake method.
func (k *Keychain) Set(service, account, password string) error {
	return nil
}

// Get always returns an empty string and no error.
func (k *Keychain) Get(service, account string) (string, error) {
	return "", nil
}

// Remove is a no-op fake method.
func (k *Keychain) Remove(service, account string) error {
	return nil
}